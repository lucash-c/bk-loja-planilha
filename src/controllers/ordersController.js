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
const {
  normalizeMoney,
  calculateOrderMonetarySummary
} = require('../utils/orderPricing');
const { pedidoDebugLog } = require('../utils/pedidoDebugLogger');

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

let ordersUpdatedAtSupportCache = null;

async function hasReliableOrdersUpdatedAtColumn() {
  if (ordersUpdatedAtSupportCache !== null) {
    return ordersUpdatedAtSupportCache;
  }

  try {
    if (db.supportsForUpdate) {
      const result = await db.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'orders'
          AND column_name = 'updated_at'
        LIMIT 1
        `
      );
      ordersUpdatedAtSupportCache = result.rows.length > 0;
      return ordersUpdatedAtSupportCache;
    }

    const result = await db.query(`PRAGMA table_info('orders')`);
    ordersUpdatedAtSupportCache = result.rows.some(column => column.name === 'updated_at');
    return ordersUpdatedAtSupportCache;
  } catch (err) {
    ordersUpdatedAtSupportCache = false;
    return false;
  }
}

function serializeOrderItemOptions(item) {
  const resolvedOptions = resolveOrderItemOptions(item);
  const optionsJson = resolvedOptions && resolvedOptions.length
    ? JSON.stringify(resolvedOptions)
    : null;

  return {
    resolvedOptions,
    optionsJson
  };
}

function normalizeOrderItem(item, { quantity, unitPrice, totalPrice } = {}) {
  const observation =
    item.observation || item.observacao || item.obs || item.observação || null;
  const { resolvedOptions, optionsJson } = serializeOrderItemOptions(item);

  return {
    product_name: item.product_name,
    quantity: typeof quantity === 'number' ? quantity : item.quantity || 1,
    unit_price: typeof unitPrice === 'number' ? unitPrice : item.unit_price || 0,
    total_price: typeof totalPrice === 'number' ? totalPrice : 0,
    observation,
    options_json: optionsJson,
    resolvedOptions
  };
}

function buildOrderItemInsertPayload(orderId, normalizedItem) {
  return {
    order_id: orderId,
    product_name: normalizedItem.product_name,
    quantity: normalizedItem.quantity,
    unit_price: normalizedItem.unit_price,
    total_price: normalizedItem.total_price,
    observation: normalizedItem.observation,
    options_json: normalizedItem.options_json
  };
}

/**
 * CREATE ORDER
 */
async function createOrder(req, res, next) {
  try {
    const lojaId = req.loja.id;
    pedidoDebugLog('createOrder:req-body', {
      lojaId,
      body: req.body,
      items: req.body?.items
    });

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

    if (typeof total !== 'undefined' && normalizeMoney(total) === null) {
      return res.status(400).json({ error: 'Total inválido' });
    }

    const paymentMethodError = await validateStorePaymentMethod({
      lojaId,
      paymentMethod: payment_method
    });
    if (paymentMethodError) {
      return res.status(400).json({ error: paymentMethodError });
    }

    const id = uuidv4();
    pedidoDebugLog('createOrder:order-id-generated', {
      lojaId,
      orderId: id
    });

    const normalizedItemsWithOptions = items.map(item => {
      const { resolvedOptions } = serializeOrderItemOptions(item);
      return {
        ...item,
        resolvedOptions
      };
    });
    const monetarySummary = calculateOrderMonetarySummary({
      items: normalizedItemsWithOptions,
      total,
      delivery_fee,
      order_type: order_type || 'entrega'
    });
    let persistedItems = [];

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
          monetarySummary.delivery_fee,
          delivery_estimated_time_minutes || null,
          monetarySummary.order_total,
          payment_method || null,
          origin || 'cliente',
          notes || null
        ]
      );

      persistedItems = [];
      const itemValues = [];
      const insertItemPayload = [];
      const itemPlaceholders = monetarySummary.items.map((it, index) => {
        pedidoDebugLog('createOrder:item-before-normalize', {
          orderId: id,
          index,
          item: it,
          options: it?.options,
          options_json: it?.options_json,
          keys: Object.keys(it || {})
        });
        const normalizedItem = normalizeOrderItem(it, {
          quantity: it.quantity,
          unitPrice: it.unit_price,
          totalPrice: it.total_price
        });
        pedidoDebugLog('createOrder:item-after-normalize', {
          orderId: id,
          index,
          resolvedOptions: normalizedItem.resolvedOptions,
          optionsJson: normalizedItem.options_json
        });
        const baseIndex = index * 7;
        const insertRowPayload = buildOrderItemInsertPayload(id, normalizedItem);

        itemValues.push(
          insertRowPayload.order_id,
          insertRowPayload.product_name,
          insertRowPayload.quantity,
          insertRowPayload.unit_price,
          insertRowPayload.total_price,
          insertRowPayload.observation,
          insertRowPayload.options_json
        );
        insertItemPayload.push(insertRowPayload);
        persistedItems.push(normalizedItem);
        pedidoDebugLog('insert-order-items:row', insertRowPayload);

        return `($${baseIndex + 1},$${baseIndex + 2},$${baseIndex + 3},$${baseIndex + 4},$${baseIndex + 5},$${baseIndex + 6},$${baseIndex + 7})`;
      });
      pedidoDebugLog('createOrder:insert-order-items-payload', {
        orderId: id,
        insertItemPayload
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
        delivery_fee: monetarySummary.delivery_fee,
        delivery_estimated_time_minutes: delivery_estimated_time_minutes || null,
        total: monetarySummary.order_total,
        payment_method: payment_method || null,
        origin: origin || 'cliente',
        payment_status: 'pending',
        status: 'new',
        notes: notes || null,
        items: persistedItems
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
        pedidoDebugLog('createPdvTransactional:req-body', {
          lojaId,
          body: req.body,
          items: req.body?.items
        });
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
        if (typeof total !== 'undefined' && normalizedTotal === null) {
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
        const normalizedItemsWithOptions = items.map(item => {
          const { resolvedOptions } = serializeOrderItemOptions(item);
          return {
            ...item,
            resolvedOptions
          };
        });
        const monetarySummary = calculateOrderMonetarySummary({
          items: normalizedItemsWithOptions,
          total,
          delivery_fee,
          order_type: order_type || 'entrega'
        });
        pedidoDebugLog('createPdvTransactional:order-id-generated', {
          lojaId,
          orderId
        });

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
              monetarySummary.delivery_fee,
              delivery_estimated_time_minutes || null,
              monetarySummary.order_total,
              payment_method || null,
              'pdv',
              'em preparo',
              notes || null
            ]
          );

          const itemValues = [];
          const insertItemPayload = [];
          const persistedItems = [];
          const itemPlaceholders = monetarySummary.items.map((it, index) => {
            pedidoDebugLog('createPdvTransactional:item-before-normalize', {
              orderId,
              index,
              item: it,
              options: it?.options,
              options_json: it?.options_json,
              keys: Object.keys(it || {})
            });
            const normalizedItem = normalizeOrderItem(it, {
              quantity: it.quantity,
              unitPrice: it.unit_price,
              totalPrice: it.total_price
            });
            pedidoDebugLog('createPdvTransactional:item-after-normalize', {
              orderId,
              index,
              resolvedOptions: normalizedItem.resolvedOptions,
              optionsJson: normalizedItem.options_json
            });
            const baseIndex = index * 7;
            const insertRowPayload = buildOrderItemInsertPayload(orderId, normalizedItem);

            itemValues.push(
              insertRowPayload.order_id,
              insertRowPayload.product_name,
              insertRowPayload.quantity,
              insertRowPayload.unit_price,
              insertRowPayload.total_price,
              insertRowPayload.observation,
              insertRowPayload.options_json
            );
            insertItemPayload.push(insertRowPayload);
            persistedItems.push(normalizedItem);
            pedidoDebugLog('insert-order-items:row', insertRowPayload);

            return `($${baseIndex + 1},$${baseIndex + 2},$${baseIndex + 3},$${baseIndex + 4},$${baseIndex + 5},$${baseIndex + 6},$${baseIndex + 7})`;
          });
          pedidoDebugLog('createPdvTransactional:insert-order-items-payload', {
            orderId,
            insertItemPayload
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
          const persistedItemsRes = await tx.query(
            `
            SELECT id, order_id, product_name, options_json
            FROM order_items
            WHERE order_id = $1
            ORDER BY created_at ASC
            `,
            [orderId]
          );
          pedidoDebugLog('createPdvTransactional:post-insert-order-items-read', {
            orderId,
            persistedRows: persistedItemsRes.rows
          });

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
              total: monetarySummary.order_total,
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
                total: monetarySummary.order_total,
                items: persistedItems
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

    const parseBooleanParam = value => {
      if (value === undefined) return false;
      return String(value).toLowerCase() === 'true';
    };

    const parseDateParam = (value, fieldName) => {
      if (!value) return null;
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) {
        const error = new Error(`Parâmetro inválido: ${fieldName}`);
        error.status = 400;
        throw error;
      }
      return parsed.toISOString();
    };

    const parseIntegerParam = ({ value, fieldName, min, max, defaultValue }) => {
      if (value === undefined || value === null || value === '') {
        return defaultValue;
      }

      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || String(parsed) !== String(value).trim()) {
        const error = new Error(`Parâmetro inválido: ${fieldName}`);
        error.status = 400;
        throw error;
      }

      if (parsed < min || parsed > max) {
        const error = new Error(`Parâmetro fora do intervalo permitido: ${fieldName}`);
        error.status = 400;
        throw error;
      }

      return parsed;
    };

    const parseStatusesParam = value => {
      if (!value) return [];
      return String(value)
        .split(',')
        .map(status => status.trim().toLowerCase())
        .filter(Boolean);
    };

    const onlyOpen = parseBooleanParam(req.query.only_open);
    const onlyToday = parseBooleanParam(req.query.only_today);
    const createdAfter = parseDateParam(req.query.created_after, 'created_after');
    const updatedAfter = parseDateParam(req.query.updated_after, 'updated_after');
    const limit = parseIntegerParam({
      value: req.query.limit,
      fieldName: 'limit',
      min: 1,
      max: 200,
      defaultValue: 200
    });
    const itemsLimitPerOrder = parseIntegerParam({
      value: req.query.items_limit_per_order,
      fieldName: 'items_limit_per_order',
      min: 1,
      max: 100,
      defaultValue: null
    });
    const statuses = parseStatusesParam(req.query.statuses);
    const excludeStatuses = parseStatusesParam(req.query.exclude_statuses);
    const hasUpdatedAt = updatedAfter
      ? await hasReliableOrdersUpdatedAtColumn()
      : false;

    const filters = ['loja_id = $1'];
    const params = [lojaId];

    const likeValue = `%${q}%`;
    const searchParamIndex = params.push(q);
    const likeExternalIndex = params.push(likeValue);
    const likeCustomerIndex = db.supportsForUpdate
      ? likeExternalIndex
      : params.push(likeValue);

    filters.push(`(
      $${searchParamIndex} = '' OR
      external_id ${likeOperator} $${likeExternalIndex} OR
      customer_name ${likeOperator} $${likeCustomerIndex}
    )`);

    if (onlyOpen) {
      const closedStatuses = ['cancelado', 'canceled', 'finalizado', 'entregue', 'concluido', 'concluído'];
      const placeholders = closedStatuses.map(status => `$${params.push(status)}`).join(',');
      filters.push(`(status IS NULL OR LOWER(status) NOT IN (${placeholders}))`);
    }

    if (onlyToday) {
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const startOfNextDay = new Date(startOfDay);
      startOfNextDay.setUTCDate(startOfNextDay.getUTCDate() + 1);
      const startIndex = params.push(startOfDay.toISOString());
      const endIndex = params.push(startOfNextDay.toISOString());
      filters.push(`created_at >= $${startIndex}`);
      filters.push(`created_at < $${endIndex}`);
    }

    if (createdAfter) {
      filters.push(`created_at >= $${params.push(createdAfter)}`);
    }

    if (statuses.length) {
      const placeholders = statuses.map(status => `$${params.push(status)}`).join(',');
      filters.push(`LOWER(COALESCE(status, '')) IN (${placeholders})`);
    }

    if (excludeStatuses.length) {
      const placeholders = excludeStatuses.map(status => `$${params.push(status)}`).join(',');
      filters.push(`LOWER(COALESCE(status, '')) NOT IN (${placeholders})`);
    }

    // Segurança/retrocompatibilidade: só usa updated_after quando a base possui updated_at em orders.
    if (updatedAfter && hasUpdatedAt) {
      filters.push(`updated_at >= $${params.push(updatedAfter)}`);
    }

    const limitParamIndex = params.push(limit);

    const { rows } = await db.query(
      `
      SELECT *
      FROM orders
      WHERE ${filters.join('\n        AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitParamIndex}
      `,
      params
    );

    if (!include.includes('items') || rows.length === 0) {
      return res.json(rows);
    }
    pedidoDebugLog('listOrders:include-items-detected', {
      lojaId,
      include,
      orderCount: rows.length
    });

    const orderIds = rows.map(order => order.id);
    const placeholders = orderIds.map((_, index) => `$${index + 1}`).join(',');
    const itemQueryParams = [...orderIds];
    let itemsQuery = `
      SELECT *
      FROM order_items
      WHERE order_id IN (${placeholders})
    `;
    if (itemsLimitPerOrder) {
      const itemsLimitIndex = itemQueryParams.push(itemsLimitPerOrder);
      itemsQuery = `
        SELECT *
        FROM (
          SELECT oi.*,
            ROW_NUMBER() OVER (
              PARTITION BY oi.order_id
              ORDER BY oi.created_at DESC, oi.id DESC
            ) AS row_num
          FROM order_items oi
          WHERE oi.order_id IN (${placeholders})
        ) ranked_items
        WHERE row_num <= $${itemsLimitIndex}
      `;
    }

    const itemsRes = await db.query(itemsQuery, itemQueryParams);

    const itemsByOrder = new Map();
    for (const item of itemsRes.rows) {
      pedidoDebugLog('listOrders:item-raw-from-db', {
        order_id: item.order_id,
        item
      });
      const normalizedItem = normalizeItemForResponse(item);
      pedidoDebugLog('listOrders:item-after-normalizeItemForResponse', {
        order_id: item.order_id,
        normalizedItem
      });
      if (!itemsByOrder.has(item.order_id)) {
        itemsByOrder.set(item.order_id, []);
      }
      itemsByOrder.get(item.order_id).push(normalizedItem);
    }

    const ordersWithItems = rows.map(order => ({
      ...order,
      items: itemsByOrder.get(order.id) || []
    }));
    for (const order of ordersWithItems) {
      pedidoDebugLog('listOrders:response-order-payload', {
        order_id: order.id,
        payload: order
      });
    }

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
    pedidoDebugLog('getOrder:requested-id', {
      lojaId,
      requestedId: id
    });

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
    pedidoDebugLog('getOrder:items-raw-from-db', {
      orderId: order.id,
      rows: items
    });
    const normalizedItems = items.map(item => {
      pedidoDebugLog('getOrder:item-row-from-db', {
        orderId: order.id,
        item
      });
      const normalizedItem = normalizeItemForResponse(item);
      pedidoDebugLog('getOrder:item-after-normalizeItemForResponse', {
        orderId: order.id,
        normalizedItem
      });
      return normalizedItem;
    });
    order.items = normalizedItems;
    pedidoDebugLog('getOrder:response-payload', {
      orderId: order.id,
      payload: order
    });

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
