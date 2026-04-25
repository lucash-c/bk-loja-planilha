const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `orders-public-status-legacy-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

async function invoke(handler, req) {
  const res = createRes();
  let nextError = null;

  await handler(req, res, err => {
    nextError = err;
  });

  if (nextError) throw nextError;
  return res;
}

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, status TEXT, payment_method TEXT, payment_status TEXT, customer_name TEXT, customer_whatsapp TEXT, notes TEXT, order_type TEXT, delivery_address TEXT, delivery_fee NUMERIC, delivery_distance_km NUMERIC, delivery_estimated_time_minutes INTEGER, total NUMERIC, created_at TEXT)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT)');
  await db.query('CREATE TABLE public_pix_checkout_sessions (id TEXT PRIMARY KEY, loja_id TEXT, order_id TEXT, status TEXT, created_at TEXT, updated_at TEXT)');
}

async function run() {
  await setupSchema();

  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-legacy', 'key-legacy', 'Loja Legacy', 1]);

  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_fee, delivery_distance_km, delivery_estimated_time_minutes, total, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    ['order-legacy', 'loja-legacy', 'ext-legacy', 'new', 'pix', 'pending', 'Cliente Legacy', '5511000000000', 'nota legacy', 'entrega', 'Rua Legacy, 1', 5, 2, 25, 30, '2026-04-04T12:00:00.000Z']
  );

  await db.query(
    `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price, observation, options_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    ['item-b', 'order-legacy', 'Produto B', 1, 10, 10, null, null]
  );

  await db.query(
    `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price, observation, options_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    ['item-a', 'order-legacy', 'Produto A', 2, 10, 20, 'sem cebola', '{"size":"grande"}']
  );

  const response = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-legacy' },
    loja: { id: 'loja-legacy' }
  });

  assert.strictEqual(response.statusCode, 200);
  assert.strictEqual(response.body.ok, true);
  assert.strictEqual(response.body.order.id, 'order-legacy');
  assert.strictEqual(response.body.order.updated_at, '2026-04-04T12:00:00.000Z');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(response.body.order, 'customer_whatsapp'), false);
  assert.deepStrictEqual(response.body.order.items.map(item => item.id), ['item-a', 'item-b']);

  const notFound = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'does-not-exist' },
    loja: { id: 'loja-legacy' }
  });
  assert.strictEqual(notFound.statusCode, 404);
  assert.strictEqual(notFound.body.error, 'Pedido não encontrado');

  console.log('Orders public status legacy schema integration tests passed');
}

run()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.unlinkSync(tempDbPath);
    } catch (_) {}
  });
