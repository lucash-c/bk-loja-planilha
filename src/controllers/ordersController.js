const crypto = require('crypto');
const db = require('../config/db');
const { CREDIT_COST_PER_ORDER } = require('../config/orderCredits');
const { v4: uuidv4 } = require('uuid');
const idempotencyCache = require('../services/idempotencyCache');
const { EVENT_VERSION, ordersRealtimeService } = require('../services/ordersRealtimeService');
const { sanitizeOrderPayload, enqueueOrderPushJob } = require('../services/pushNotificationService');
const {
  resolveOrderItemOptions,
  normalizeItemForResponse
} = require('../utils/orderItemOptions');

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    return `{${sortedKeys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function buildRequestHash(payload) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(payload || {}))
    .digest('hex');
}

function getIdempotencyKey(req) {
  return req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || null;
}

function logIdempotency(event, fields) {
  console.info(`[idempotency:${event}]`, fields);
}

function normalizeMoney(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Number(num.toFixed(2));
}

async function validateStorePaymentMethod({ lojaId, paymentMethod, tx = db }) {
  if (!paymentMethod) return null;

  const code = String(paymentMethod).trim().toLowerCase();

  const paymentMethodRes = await tx.query(
    `
    SELECT id
    FROM store_payment_methods
    WHERE loja_id = $1
      AND code = $2
      AND is_active = TRUE
    LIMIT 1
    `,
    [lojaId, code]
  );

  if (!paymentMethodRes.rows.length) {
    return `Forma de pagamento "${code}" não está ativa para esta loja`;
  }

  return null;
}

async function handleIdempotency({ req, res, storeId, scope, orderId, execute, onCompleted }) {
  const idempotencyKey = getIdempotencyKey(req);

  if (!idempotencyKey) {
    const execution = await execute({ idempotencyKey: null, requestHash: null });
    if (onCompleted) {
      await onCompleted(execution);
    }
    return res.status(execution.statusCode).json(execution.payload);
  }

  const requestHash = buildRequestHash(req.body || {});
  const begin = await idempotencyCache.beginProcessing({
    storeId,
    scope,
    idempotencyKey,
    requestHash
  });

  logIdempotency('begin', {
    idempotencyKey,
    scope,
    storeId,
    orderId,
    state: begin.state || (begin.acquired ? 'acquired' : 'unknown')
  });

  if (!begin.acquired) {
    if (begin.state === 'payload_mismatch') {
      return res.status(409).json({
        error: 'Payload diferente para a mesma chave idempotente',
        idempotencyKey,
        scope
      });
    }

    if (begin.state === 'completed' && begin.response) {
      return res.status(begin.statusCode || 200).json(begin.response);
    }

    return res.status(409).json({
      error: 'Requisição idempotente em processamento',
      idempotencyKey,
      scope
    });
  }

  const execution = await execute({ idempotencyKey, requestHash });

  if (onCompleted) {
    await onCompleted(execution);
  }

  if (execution && execution.persistIdempotentResult) {
    await idempotencyCache.saveCompletedResponse({
      storeId,
      scope,
      idempotencyKey,
      requestHash,
      statusCode: execution.statusCode,
      response: execution.payload
    });

    logIdempotency('completed', {
      idempotencyKey,
      scope,
      storeId,
      orderId: execution.orderId || orderId
    });
  }

  return res.status(execution.statusCode).json(execution.payload);
}

function getForUpdateClause() {
  return db.supportsForUpdate ? 'FOR UPDATE' : '';
}

async function publishOrderEvent({ type, orderId, lojaId, fallbackOrder }) {
  let order = fallbackOrder;
  if (!order && orderId) {
    const result = await db.query(
      `
      SELECT id, loja_id, customer_name, customer_whatsapp, status, total, created_at
      FROM orders
      WHERE id = $1
        AND loja_id = $2
      LIMIT 1
      `,
      [orderId, lojaId]
    );
    order = result.rows[0] || null;
  }

  if (!order) return;

  ordersRealtimeService.publish({
    type,
    storeId: lojaId,
    order
  });

  const sanitizedPayload = sanitizeOrderPayload(order);
  if (!sanitizedPayload) return;

  await enqueueOrderPushJob({
    orderId: order.id,
    lojaId,
    eventType: type,
    payload: sanitizedPayload
  });
}

async function isRealtimeEnabledForStore(lojaId) {
  const globalFlag = process.env.ORDERS_REALTIME_ENABLED;
  if (globalFlag === 'false') return false;

  try {
    const result = await db.query(
      `
      SELECT orders_realtime_enabled
      FROM store_settings
      WHERE loja_id = $1
      LIMIT 1
      `,
      [lojaId]
    );

    if (!result.rows.length) {
      return globalFlag === 'true';
    }

    return Boolean(result.rows[0].orders_realtime_enabled);
  } catch (err) {
    return globalFlag === 'true';
  }
}

/**
 * CREATE ORDER
 */
async function createOrder(req, res, next) {
  try {
    const lojaId = req.loja.id;

    const {
      external_id,
      customer_name,
      customer_whatsapp,
      delivery_address,
      delivery_fee,
      delivery_distance_km,
      delivery_estimated_time_minutes,
      order_type,
      payment_method,
      origin,
      total,
      notes,
      items = []
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Pedido sem itens' });
    }

    if (origin && !['cliente', 'pdv'].includes(origin)) {
      return res.status(400).json({ error: 'Origem inválida' });
    }

    if (order_type && !['entrega', 'retirada', 'local'].includes(order_type)) {
      return res.status(400).json({ error: 'Tipo de pedido inválido' });
    }

    const paymentMethodError = await validateStorePaymentMethod({
      lojaId,
      paymentMethod: payment_method
    });
    if (paymentMethodError) {
      return res.status(400).json({ error: paymentMethodError });
    }

    const id = uuidv4();

    await db.withTransaction(async tx => {
      await tx.query(
        `
        INSERT INTO orders (
          id,
          loja_id,
          external_id,
          customer_name,
          customer_whatsapp,
          order_type,
          delivery_address,
          delivery_distance_km,
          delivery_fee,
          delivery_estimated_time_minutes,
          total,
          payment_method,
          origin,
          notes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        `,
        [
          id,
          lojaId,
          external_id || null,
          customer_name || null,
          customer_whatsapp || null,
          order_type || 'entrega',
          delivery_address || null,
          delivery_distance_km || null,
          delivery_fee ?? 0,
          delivery_estimated_time_minutes || null,
          total ?? 0,
          payment_method || null,
          origin || 'cliente',
          notes || null
        ]
      );

      const itemValues = [];
      const itemPlaceholders = items.map((it, index) => {
        const quantity = it.quantity || 1;
        const unitPrice = it.unit_price || 0;
        const totalPrice = quantity * unitPrice;
        const observation =
          it.observation || it.observacao || it.obs || it.observação || null;
        const resolvedOptions = resolveOrderItemOptions(it);
        const optionsJson = resolvedOptions ? JSON.stringify(resolvedOptions) : null;
        const baseIndex = index * 7;

        itemValues.push(
          id,
          it.product_name,
          quantity,
          unitPrice,
          totalPrice,
          observation,
          optionsJson
        );

        return `($${baseIndex + 1},$${baseIndex + 2},$${baseIndex + 3},$${baseIndex + 4},$${baseIndex + 5},$${baseIndex + 6},$${baseIndex + 7})`;
      });

      await tx.query(
        `
        INSERT INTO order_items (
          order_id,
          product_name,
          quantity,
          unit_price,
          total_price,
          observation,
          options_json
        )
        VALUES ${itemPlaceholders.join(',')}
        `,
        itemValues
      );

      await tx.query(
        `
        INSERT INTO order_jobs (
          order_id,
          loja_id,
          job_type,
          payload
        )
        VALUES ($1, $2, $3, $4)
        `,
        [
          id,
          lojaId,
          'post_order_actions',
          JSON.stringify({
            order_id: id,
            loja_id: lojaId,
            actions: {
              send_whatsapp: true,
              send_email: true,
              integrate_erp: true
            }
          })
        ]
      );
    });

    res.status(201).json({
      ok: true,
      order: {
        id,
        loja_id: lojaId,
        external_id: external_id || null,
        customer_name: customer_name || null,
        customer_whatsapp: customer_whatsapp || null,
        order_type: order_type || 'entrega',
        delivery_address: delivery_address || null,
        delivery_distance_km: delivery_distance_km || null,
        delivery_fee: delivery_fee ?? 0,
        delivery_estimated_time_minutes: delivery_estimated_time_minutes || null,
        total: total ?? 0,
        payment_method: payment_method || null,
        origin: origin || 'cliente',
        payment_status: 'pending',
        status: 'new',
        notes: notes || null,
        items
      }
    });

    await publishOrderEvent({
      type: 'order.created',
      orderId: id,
      lojaId
    });
  } catch (err) {
    next(err);
  }
}

async function acceptTransactional(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const orderId = req.params.id;
    const scope = 'accept-transactional';

    return await handleIdempotency({
      req,
      res,
      storeId: lojaId,
      scope,
      orderId,
      onCompleted: async execution => {
        if (execution?.statusCode < 300 && execution.eventOrder) {
          await publishOrderEvent({
            type: 'order.updated',
            lojaId,
            fallbackOrder: execution.eventOrder
          });
        }
      },
      execute: async () => {
        const forUpdate = getForUpdateClause();
        const result = await db.withTransaction(async tx => {
          const orderRes = await tx.query(
            `
            SELECT id, loja_id, status
            FROM orders
            WHERE id = $1
              AND loja_id = $2
            ${forUpdate}
            `,
            [orderId, lojaId]
          );

          if (!orderRes.rows.length) {
            return {
              statusCode: 404,
              payload: { error: 'Pedido não encontrado' },
              persistIdempotentResult: false
            };
          }

          const order = orderRes.rows[0];
          if (!['aguardando aceite', 'new'].includes(order.status)) {
            return {
              statusCode: 409,
              payload: {
                error: 'Pedido não está aguardando aceite',
                current_status: order.status
              },
              persistIdempotentResult: false
            };
          }

          const creditsRes = await tx.query(
            `
            SELECT id, credits
            FROM user_lojas
            WHERE loja_id = $1
              AND role = 'owner'
            LIMIT 1
            ${forUpdate}
            `,
            [lojaId]
          );

          if (!creditsRes.rows.length) {
            return {
              statusCode: 404,
              payload: { error: 'Saldo da loja não encontrado' },
              persistIdempotentResult: false
            };
          }

          const currentCredits = Number(creditsRes.rows[0].credits);
          const amount = CREDIT_COST_PER_ORDER;
          if (currentCredits < amount) {
            return {
              statusCode: 400,
              payload: {
                error: 'Créditos insuficientes',
                credits: currentCredits,
                required: amount
              },
              persistIdempotentResult: false
            };
          }

          await tx.query(
            `
            UPDATE user_lojas
            SET credits = credits - $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            `,
            [amount, creditsRes.rows[0].id]
          );

          if (req.headers['x-test-force-fail'] === '1') {
            throw new Error('forced transactional failure');
          }

          await tx.query(
            `
            UPDATE orders
            SET status = 'em preparo'
            WHERE id = $1
            `,
            [order.id]
          );

          const updatedCredits = currentCredits - amount;
          const updatedOrderRes = await tx.query(
            `
            SELECT id, loja_id, customer_name, customer_whatsapp, status, total, created_at
            FROM orders
            WHERE id = $1
            LIMIT 1
            `,
            [order.id]
          );

          return {
            statusCode: 200,
            persistIdempotentResult: true,
            orderId: order.id,
            eventOrder: updatedOrderRes.rows[0] || null,
            payload: {
              ok: true,
              order_id: order.id,
              loja_id: lojaId,
              status: 'em preparo',
              debited_credits: amount,
              remaining_credits: Number(updatedCredits.toFixed(2))
            }
          };
        });

        return result;
      }
    });
  } catch (err) {
    next(err);
  }
}

async function createPdvTransactional(req, res, next) {
  try {
    const lojaKey = req.headers['x-loja-key'];
    if (!lojaKey) {
      return res.status(400).json({ error: 'X-LOJA-KEY é obrigatório' });
    }

    const lojaRes = await db.query(
      `
      SELECT id, name
      FROM lojas
      WHERE public_key = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [lojaKey]
    );

    if (!lojaRes.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada ou inativa' });
    }

    const lojaId = lojaRes.rows[0].id;
    const scope = 'pdv-transactional';

    return await handleIdempotency({
      req,
      res,
      storeId: lojaId,
      scope,
      onCompleted: async execution => {
        if (execution?.statusCode < 300 && execution.eventOrder) {
          await publishOrderEvent({
            type: 'order.created',
            lojaId,
            fallbackOrder: execution.eventOrder
          });
        }
      },
      execute: async () => {
        const {
          external_id,
          customer_name,
          customer_whatsapp,
          delivery_address,
          delivery_fee,
          delivery_distance_km,
          delivery_estimated_time_minutes,
          order_type,
          payment_method,
          total,
          notes,
          items = []
        } = req.body;

        if (!Array.isArray(items) || items.length === 0) {
          return {
            statusCode: 400,
            payload: { error: 'Pedido sem itens' },
            persistIdempotentResult: false
          };
        }

        const normalizedTotal = normalizeMoney(total);
        if (normalizedTotal === null) {
          return {
            statusCode: 400,
            payload: { error: 'Total inválido' },
            persistIdempotentResult: false
          };
        }

        if (order_type && !['entrega', 'retirada', 'local'].includes(order_type)) {
          return {
            statusCode: 400,
            payload: { error: 'Tipo de pedido inválido' },
            persistIdempotentResult: false
          };
        }

        const paymentMethodError = await validateStorePaymentMethod({
          lojaId,
          paymentMethod: payment_method
        });
        if (paymentMethodError) {
          return {
            statusCode: 400,
            payload: { error: paymentMethodError },
            persistIdempotentResult: false
          };
        }

        const forUpdate = getForUpdateClause();
        const orderId = uuidv4();

        return db.withTransaction(async tx => {
          const creditsRes = await tx.query(
            `
            SELECT id, credits
            FROM user_lojas
            WHERE loja_id = $1
              AND role = 'owner'
            LIMIT 1
            ${forUpdate}
            `,
            [lojaId]
          );

          if (!creditsRes.rows.length) {
            return {
              statusCode: 404,
              payload: { error: 'Saldo da loja não encontrado' },
              persistIdempotentResult: false
            };
          }

          const currentCredits = Number(creditsRes.rows[0].credits);
          if (currentCredits < CREDIT_COST_PER_ORDER) {
            return {
              statusCode: 400,
              payload: {
                error: 'Créditos insuficientes',
                credits: currentCredits,
                required: CREDIT_COST_PER_ORDER
              },
              persistIdempotentResult: false
            };
          }

          await tx.query(
            `
            INSERT INTO orders (
              id,
              loja_id,
              external_id,
              customer_name,
              customer_whatsapp,
              order_type,
              delivery_address,
              delivery_distance_km,
              delivery_fee,
              delivery_estimated_time_minutes,
              total,
              payment_method,
              origin,
              status,
              notes
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
            `,
            [
              orderId,
              lojaId,
              external_id || null,
              customer_name || null,
              customer_whatsapp || null,
              order_type || 'entrega',
              delivery_address || null,
              delivery_distance_km || null,
              delivery_fee ?? 0,
              delivery_estimated_time_minutes || null,
              normalizedTotal,
              payment_method || null,
              'pdv',
              'em preparo',
              notes || null
            ]
          );

          const itemValues = [];
          const itemPlaceholders = items.map((it, index) => {
            const quantity = it.quantity || 1;
            const unitPrice = Number(it.unit_price || 0);
            const totalPrice = Number((quantity * unitPrice).toFixed(2));
            const observation =
              it.observation || it.observacao || it.obs || it.observação || null;
            const resolvedOptions = resolveOrderItemOptions(it);
            const optionsJson = resolvedOptions ? JSON.stringify(resolvedOptions) : null;
            const baseIndex = index * 7;

            itemValues.push(
              orderId,
              it.product_name,
              quantity,
              unitPrice,
              totalPrice,
              observation,
              optionsJson
            );

            return `($${baseIndex + 1},$${baseIndex + 2},$${baseIndex + 3},$${baseIndex + 4},$${baseIndex + 5},$${baseIndex + 6},$${baseIndex + 7})`;
          });

          await tx.query(
            `
            INSERT INTO order_items (
              order_id,
              product_name,
              quantity,
              unit_price,
              total_price,
              observation,
              options_json
            )
            VALUES ${itemPlaceholders.join(',')}
            `,
            itemValues
          );

          await tx.query(
            `
            UPDATE user_lojas
            SET credits = credits - $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            `,
            [CREDIT_COST_PER_ORDER, creditsRes.rows[0].id]
          );

          if (req.headers['x-test-force-fail'] === '1') {
            throw new Error('forced transactional failure');
          }

          const remainingCredits = currentCredits - CREDIT_COST_PER_ORDER;
          return {
            statusCode: 201,
            persistIdempotentResult: true,
            orderId,
            eventOrder: {
              id: orderId,
              loja_id: lojaId,
              customer_name: customer_name || null,
              customer_whatsapp: customer_whatsapp || null,
              status: 'em preparo',
              total: normalizedTotal,
              created_at: new Date().toISOString()
            },
            payload: {
              ok: true,
              order: {
                id: orderId,
                loja_id: lojaId,
                external_id: external_id || null,
                status: 'em preparo',
                origin: 'pdv',
                total: normalizedTotal,
                items
              },
              debited_credits: CREDIT_COST_PER_ORDER,
              remaining_credits: Number(remainingCredits.toFixed(2))
            }
          };
        });
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * LIST ORDERS
 */
async function listOrders(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const q = req.query.q || '';
    const likeOperator = db.supportsForUpdate ? 'ILIKE' : 'LIKE';
    const include = (req.query.include || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    const likeValue = `%${q}%`;
    const usesDuplicatedPlaceholder = db.supportsForUpdate;
    const customerLikePlaceholder = usesDuplicatedPlaceholder ? '$3' : '$4';

    const { rows } = await db.query(
      `
      SELECT *
      FROM orders
      WHERE loja_id = $1
        AND (
          $2 = '' OR
          external_id ${likeOperator} $3 OR
          customer_name ${likeOperator} ${customerLikePlaceholder}
        )
      ORDER BY created_at DESC
      LIMIT 200
      `,
      usesDuplicatedPlaceholder
        ? [lojaId, q, likeValue]
        : [lojaId, q, likeValue, likeValue]
    );

    if (!include.includes('items') || rows.length === 0) {
      return res.json(rows);
    }

    const orderIds = rows.map(order => order.id);
    const placeholders = orderIds.map((_, index) => `$${index + 1}`).join(',');

    const itemsRes = await db.query(
      `
      SELECT *
      FROM order_items
      WHERE order_id IN (${placeholders})
      `,
      orderIds
    );

    const itemsByOrder = new Map();
    for (const item of itemsRes.rows) {
      const normalizedItem = normalizeItemForResponse(item);
      if (!itemsByOrder.has(item.order_id)) {
        itemsByOrder.set(item.order_id, []);
      }
      itemsByOrder.get(item.order_id).push(normalizedItem);
    }

    const ordersWithItems = rows.map(order => ({
      ...order,
      items: itemsByOrder.get(order.id) || []
    }));

    return res.json(ordersWithItems);
  } catch (err) {
    next(err);
  }
}

/**
 * GET ORDER
 */
async function getOrder(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const id = req.params.id;

    const orderRes = await db.query(
      `
      SELECT *
      FROM orders
      WHERE loja_id = $1
        AND (id = $2 OR external_id = $3)
      `,
      [lojaId, id, id]
    );

    if (!orderRes.rows.length) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

    const order = orderRes.rows[0];

    const items = (
      await db.query(
        'SELECT * FROM order_items WHERE order_id = $1',
        [order.id]
      )
    ).rows;

    order.items = items.map(normalizeItemForResponse);

    res.json(order);
  } catch (err) {
    next(err);
  }
}

/**
 * UPDATE STATUS
 */
async function updateStatus(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const id = req.params.id;
    const { status, payment_status } = req.body;

    const updates = [];
    const params = [];
    let idx = 1;

    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      params.push(status);
    }

    if (payment_status !== undefined) {
      updates.push(`payment_status = $${idx++}`);
      params.push(payment_status);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'Nada para atualizar' });
    }

    const sql = `
      UPDATE orders
      SET ${updates.join(', ')}
      WHERE loja_id = $${idx++}
        AND (id = $${idx++} OR external_id = $${idx++})
    `;

    params.push(lojaId, id, id);

    await db.query(sql, params);

    const updated = await db.query(
      `
      SELECT *
      FROM orders
      WHERE loja_id = $1
        AND (id = $2 OR external_id = $3)
      `,
      [lojaId, id, id]
    );

    const updatedOrder = updated.rows[0];
    res.json(updatedOrder);

    if (updatedOrder) {
      await publishOrderEvent({
        type: 'order.updated',
        lojaId,
        fallbackOrder: updatedOrder
      });
    }
  } catch (err) {
    next(err);
  }
}

async function streamOrders(req, res, next) {
  try {
    if (!req.loja?.id || req.tokenType !== 'store') {
      ordersRealtimeService.markAuthError();
      return res.status(403).json({ error: 'Access denied for this store' });
    }

    const enabled = await isRealtimeEnabledForStore(req.loja.id);
    if (!enabled) {
      return res.status(503).json({
        error: 'Realtime de pedidos desabilitado para esta loja',
        fallback: 'GET /api/orders'
      });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    ordersRealtimeService.registerConnection({
      req,
      res,
      userId: req.user.id,
      storeId: req.loja.id,
      lastEventId: req.headers['last-event-id'] || null
    });

    return undefined;
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  createOrder,
  acceptTransactional,
  createPdvTransactional,
  listOrders,
  getOrder,
  updateStatus,
  streamOrders,
  EVENT_VERSION
};
