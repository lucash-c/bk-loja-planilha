const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

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

    const id = uuidv4();

    await db.query('BEGIN');
    try {
      await db.query(
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
        const optionsJson =
          it.options_json ? JSON.stringify(it.options_json) : null;
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

      await db.query(
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

      await db.query(
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

      await db.query('COMMIT');
    } catch (transactionError) {
      await db.query('ROLLBACK');
      throw transactionError;
    }

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

    const { rows } = await db.query(
      `
      SELECT *
      FROM orders
      WHERE loja_id = $1
        AND (
          $2 = '' OR
          external_id ILIKE $3 OR
          customer_name ILIKE $3
        )
      ORDER BY created_at DESC
      LIMIT 200
      `,
      [lojaId, q, `%${q}%`]
    );

    res.json(rows);
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

    order.items = items.map(it => ({
      ...it,
      options_json: it.options_json
        ? JSON.parse(it.options_json)
        : null
    }));

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

    res.json(updated.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  updateStatus
};
