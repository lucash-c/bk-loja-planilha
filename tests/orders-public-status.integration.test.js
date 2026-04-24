const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `orders-public-status-${Date.now()}.db`);
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
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, status TEXT, payment_method TEXT, payment_status TEXT, customer_name TEXT, customer_whatsapp TEXT, notes TEXT, order_type TEXT, delivery_address TEXT, delivery_fee NUMERIC, delivery_distance_km NUMERIC, delivery_estimated_time_minutes INTEGER, total NUMERIC, created_at TEXT, updated_at TEXT)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT, created_at TEXT)');
  await db.query('CREATE TABLE public_pix_checkout_sessions (id TEXT PRIMARY KEY, loja_id TEXT, order_id TEXT, status TEXT, created_at TEXT, updated_at TEXT)');
}

async function run() {
  await setupSchema();

  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'key-1', 'Loja 1', 1]);
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-2', 'key-2', 'Loja 2', 1]);

  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_fee, delivery_distance_km, delivery_estimated_time_minutes, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    ['order-new', 'loja-1', 'ext-001', 'new', 'pix', 'pending', 'Cliente A', '5511999999999', 'nota interna', 'entrega', 'Rua A, 123', 8.5, 4.2, 45, 58.4, '2026-04-04T12:00:00.000Z', '2026-04-04T12:00:01.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_fee, delivery_distance_km, delivery_estimated_time_minutes, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    ['order-prep', 'loja-1', 'ext-002', 'em preparo', 'dinheiro', 'pending', 'Cliente B', '5511888888888', 'observacao interna', 'retirada', null, 0, null, null, 32, '2026-04-04T12:05:00.000Z', '2026-04-04T12:06:00.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_fee, delivery_distance_km, delivery_estimated_time_minutes, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    ['order-cancelled', 'loja-1', 'ext-003', 'cancelado', 'pix', 'approved', 'Cliente C', '5511777777777', 'cancelado interno', 'local', null, 0, null, null, 22, '2026-04-04T12:10:00.000Z', '2026-04-04T12:11:00.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_fee, delivery_distance_km, delivery_estimated_time_minutes, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    ['order-refund', 'loja-1', 'ext-004', 'recusado', 'pix', 'approved', 'Cliente D', '5511666666666', 'refund interno', 'entrega', 'Rua B, 456', 6, null, null, 41, '2026-04-04T12:15:00.000Z', '2026-04-04T12:16:00.000Z']
  );

  await db.query(
    `INSERT INTO public_pix_checkout_sessions (id, loja_id, order_id, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['sess-1', 'loja-1', 'order-refund', 'refund_requested', '2026-04-04T12:17:00.000Z', '2026-04-04T12:18:00.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_fee, delivery_distance_km, delivery_estimated_time_minutes, total, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    ['order-other-store', 'loja-2', 'ext-005', 'new', 'pix', 'pending', 'Cliente X', '5511555555555', 'interno', 'entrega', 'Rua C, 789', 5, null, 30, 19, '2026-04-04T12:20:00.000Z', '2026-04-04T12:21:00.000Z']
  );

  await db.query(
    `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price, observation, options_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['item-2', 'order-new', 'Refrigerante', 2, 6.7, 13.4, null, '{"ice":true}', '2026-04-04T12:00:03.000Z']
  );

  await db.query(
    `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price, observation, options_json, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['item-1', 'order-new', 'Pizza Calabresa', 1, 45, 45, 'sem cebola', '{"size":"grande"}', '2026-04-04T12:00:02.000Z']
  );

  const orderFromCorrectStore = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-new' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(orderFromCorrectStore.statusCode, 200);
  assert.strictEqual(orderFromCorrectStore.body.ok, true);
  assert.strictEqual(orderFromCorrectStore.body.order.id, 'order-new');
  assert.strictEqual(orderFromCorrectStore.body.order.status, 'new');
  assert.strictEqual(orderFromCorrectStore.body.order.external_id, 'ext-001');
  assert.strictEqual(orderFromCorrectStore.body.order.order_type, 'entrega');
  assert.strictEqual(orderFromCorrectStore.body.order.delivery_address, 'Rua A, 123');
  assert.strictEqual(orderFromCorrectStore.body.order.delivery_fee, 8.5);
  assert.strictEqual(orderFromCorrectStore.body.order.delivery_distance_km, 4.2);
  assert.strictEqual(orderFromCorrectStore.body.order.delivery_estimated_time_minutes, 45);
  assert.strictEqual(orderFromCorrectStore.body.order.total, 58.4);
  assert.strictEqual(orderFromCorrectStore.body.order.notes, 'nota interna');
  assert.strictEqual(orderFromCorrectStore.body.order.items.length, 2);
  assert.deepStrictEqual(orderFromCorrectStore.body.order.items.map(item => item.id), ['item-1', 'item-2']);
  assert.deepStrictEqual(orderFromCorrectStore.body.order.items[0], {
    id: 'item-1',
    product_name: 'Pizza Calabresa',
    quantity: 1,
    unit_price: 45,
    total_price: 45,
    observation: 'sem cebola',
    options_json: '{"size":"grande"}'
  });

  const orderFromAnotherStore = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-other-store' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(orderFromAnotherStore.statusCode, 404);
  assert.strictEqual(orderFromAnotherStore.body.error, 'Pedido não encontrado');

  const inPreparation = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-prep' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(inPreparation.statusCode, 200);
  assert.strictEqual(inPreparation.body.order.status, 'em preparo');
  assert.strictEqual(inPreparation.body.order.order_type, 'retirada');
  assert.strictEqual(inPreparation.body.order.delivery_address, null);
  assert.strictEqual(inPreparation.body.order.delivery_fee, 0);
  assert.strictEqual(inPreparation.body.order.delivery_estimated_time_minutes, null);

  const cancelledWithoutRefundFlag = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-cancelled' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(cancelledWithoutRefundFlag.statusCode, 200);
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.status, 'cancelado');
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.order_type, 'local');
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.delivery_address, null);
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.delivery_fee, 0);
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.delivery_estimated_time_minutes, null);
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.customer_message_code, null);
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.customer_message, null);

  const cancelledWithRefundRequested = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-refund' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(cancelledWithRefundRequested.statusCode, 200);
  assert.strictEqual(cancelledWithRefundRequested.body.order.status, 'recusado');
  assert.strictEqual(cancelledWithRefundRequested.body.order.customer_message_code, 'order_cancelled_refund_requested');
  assert.strictEqual(
    cancelledWithRefundRequested.body.order.customer_message,
    'Por algum motivo o pedido não foi aceito e o reembolso já está sendo solicitado. Caso não receba nas próximas 24 horas, entre em contato com a loja.'
  );

  assert.strictEqual(Object.prototype.hasOwnProperty.call(cancelledWithRefundRequested.body.order, 'notes'), true);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(cancelledWithRefundRequested.body.order, 'customer_whatsapp'), false);

  console.log('Orders public status integration tests passed');
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
