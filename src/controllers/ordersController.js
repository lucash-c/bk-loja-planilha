const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// cria um pedido com itens (espera payload: external_id, customer_name,... items: [{product_name, quantity, unit_price}])
async function createOrder(req, res, next) {
  try {
    const {
      external_id, customer_name, customer_whatsapp, delivery_address,
      payment_method, total, notes, items = []
    } = req.body;

    const id = uuidv4();
    const insertOrderSql = `INSERT INTO orders (id, external_id, customer_name, customer_whatsapp, delivery_address, total, payment_method, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`;
    await db.query(insertOrderSql, [id, external_id || null, customer_name, customer_whatsapp, delivery_address, total, payment_method, notes]);

    for (const it of items) {
      const t = (it.quantity || 1) * (it.unit_price || 0);
      await db.query(
        `INSERT INTO order_items (order_id, product_name, quantity, unit_price, total_price) VALUES ($1,$2,$3,$4,$5)`,
        [id, it.product_name, it.quantity || 1, it.unit_price || 0, t]
      );
    }

    // Retornar o pedido salvo
    const orderSaved = (await db.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
    res.status(201).json({ ok: true, order: orderSaved });
  } catch (err) {
    next(err);
  }
}

async function listOrders(req, res, next) {
  try {
    const q = req.query.q || '';
    let rows;
    if (q) {
      rows = (await db.query(`SELECT * FROM orders WHERE external_id ILIKE $1 OR customer_name ILIKE $1 ORDER BY created_at DESC`, [`%${q}%`])).rows;
    } else {
      rows = (await db.query(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`)).rows;
    }
    res.json(rows);
  } catch (err) {
    next(err);
  }
}

async function getOrder(req, res, next) {
  try {
    const id = req.params.id;
    const orderRes = await db.query('SELECT * FROM orders WHERE id = $1 OR external_id = $1', [id]);
    if (!orderRes.rows.length) return res.status(404).json({ error: 'Pedido não encontrado' });
    const order = orderRes.rows[0];
    const items = (await db.query('SELECT * FROM order_items WHERE order_id = $1', [order.id])).rows;
    order.items = items;
    res.json(order);
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const id = req.params.id;
    const { status, payment_status } = req.body;
    const updates = [];
    const params = [];
    let idx = 1;

    if (status) {
      updates.push(`status = $${idx++}`);
      params.push(status);
    }
    if (payment_status) {
      updates.push(`payment_status = $${idx++}`);
      params.push(payment_status);
    }
    if (!updates.length) return res.status(400).json({ error: 'Nada para atualizar' });

    params.push(id);
    const sql = `UPDATE orders SET ${updates.join(', ')} WHERE id = $${idx} OR external_id = $${idx} RETURNING *`;
    const result = await db.query(sql, params);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { createOrder, listOrders, getOrder, updateStatus };
