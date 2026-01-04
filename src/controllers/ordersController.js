const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

/**
 * CREATE ORDER
 * Pedido SEMPRE vinculado à loja resolvida pelo middleware
 * (JWT ou X-LOJA-KEY)
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
      payment_method,
      total,
      notes,
      items = []
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Pedido sem itens' });
    }

    const id = uuidv4();

    await db.query(
      `
      INSERT INTO orders (
        id,
        loja_id,
        external_id,
        customer_name,
        customer_whatsapp,
        delivery_address,
        delivery_distance_km,
        delivery_fee,
        total,
        payment_method,
        notes
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      `,
      [
        id,
        lojaId,
        external_id || null,
        customer_name || null,
        customer_whatsapp || null,
        delivery_address || null,
        delivery_distance_km || null,
        delivery_fee ?? 0,
        total ?? 0,
        payment_method || null,
        notes || null
      ]
    );

    for (const it of items) {       
      const quantity = it.quantity || 1;
      const unitPrice = it.unit_price || 0;
      const totalPrice = quantity * unitPrice;

      const optionsJson =
        it.options_json ? JSON.stringify(it.options_json) : null;

      await db.query(
        `
        INSERT INTO order_items (
          order_id,
          product_name,
          quantity,
          unit_price,
          total_price,
          options_json
        )
        VALUES ($1,$2,$3,$4,$5,$6)
        `,
        [
          id,
          it.product_name,
          quantity,
          unitPrice,
          totalPrice,
          optionsJson
        ]
      );
    }

    const order = {
      id,
      loja_id: lojaId,
      external_id: external_id || null,
      customer_name: customer_name || null,
      customer_whatsapp: customer_whatsapp || null,
      delivery_address: delivery_address || null,
      delivery_distance_km: delivery_distance_km || null,
      delivery_fee: delivery_fee ?? 0,
      total: total ?? 0,
      payment_method: payment_method || null,
      payment_status: 'pending',
      status: 'new',
      notes: notes || null,
      items
    };

    res.status(201).json({ ok: true, order });
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

    let rows;

    if (q) {
      rows = (
        await db.query(
          `
          SELECT *
          FROM orders
          WHERE loja_id = $1
            AND (
              external_id ILIKE $2
              OR customer_name ILIKE $2
            )
          ORDER BY created_at DESC
          LIMIT 200
          `,
          [lojaId, `%${q}%`]
        )
      ).rows;
    } else {
      rows = (
        await db.query(
          `
          SELECT *
          FROM orders
          WHERE loja_id = $1
          ORDER BY created_at DESC
          LIMIT 200
          `,
          [lojaId]
        )
      ).rows;
    }

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

    const result = await db.query(sql, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado' });
    }

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
