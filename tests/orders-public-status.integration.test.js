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
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, status TEXT, payment_method TEXT, payment_status TEXT, customer_name TEXT, customer_whatsapp TEXT, notes TEXT, order_type TEXT, delivery_address TEXT, delivery_estimated_time_minutes INTEGER, created_at TEXT, updated_at TEXT)');
  await db.query('CREATE TABLE public_pix_checkout_sessions (id TEXT PRIMARY KEY, loja_id TEXT, order_id TEXT, status TEXT, created_at TEXT, updated_at TEXT)');
}

async function run() {
  await setupSchema();

  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'key-1', 'Loja 1', 1]);
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-2', 'key-2', 'Loja 2', 1]);

  await db.query(
    `INSERT INTO orders (id, loja_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_estimated_time_minutes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    ['order-new', 'loja-1', 'new', 'pix', 'pending', 'Cliente A', '5511999999999', 'nota interna', 'entrega', 'Rua A, 123', 45, '2026-04-04T12:00:00.000Z', '2026-04-04T12:00:01.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_estimated_time_minutes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    ['order-prep', 'loja-1', 'em preparo', 'dinheiro', 'pending', 'Cliente B', '5511888888888', 'observacao interna', 'retirada', null, null, '2026-04-04T12:05:00.000Z', '2026-04-04T12:06:00.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_estimated_time_minutes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    ['order-cancelled', 'loja-1', 'cancelado', 'pix', 'approved', 'Cliente C', '5511777777777', 'cancelado interno', 'local', null, null, '2026-04-04T12:10:00.000Z', '2026-04-04T12:11:00.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_estimated_time_minutes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    ['order-refund', 'loja-1', 'recusado', 'pix', 'approved', 'Cliente D', '5511666666666', 'refund interno', 'entrega', 'Rua B, 456', null, '2026-04-04T12:15:00.000Z', '2026-04-04T12:16:00.000Z']
  );

  await db.query(
    `INSERT INTO public_pix_checkout_sessions (id, loja_id, order_id, status, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    ['sess-1', 'loja-1', 'order-refund', 'refund_requested', '2026-04-04T12:17:00.000Z', '2026-04-04T12:18:00.000Z']
  );

  await db.query(
    `INSERT INTO orders (id, loja_id, status, payment_method, payment_status, customer_name, customer_whatsapp, notes, order_type, delivery_address, delivery_estimated_time_minutes, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    ['order-other-store', 'loja-2', 'new', 'pix', 'pending', 'Cliente X', '5511555555555', 'interno', 'entrega', 'Rua C, 789', 30, '2026-04-04T12:20:00.000Z', '2026-04-04T12:21:00.000Z']
  );

  const orderFromCorrectStore = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-new' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(orderFromCorrectStore.statusCode, 200);
  assert.strictEqual(orderFromCorrectStore.body.ok, true);
  assert.strictEqual(orderFromCorrectStore.body.order.id, 'order-new');
  assert.strictEqual(orderFromCorrectStore.body.order.status, 'new');
  assert.strictEqual(orderFromCorrectStore.body.order.order_type, 'entrega');
  assert.strictEqual(orderFromCorrectStore.body.order.delivery_address, 'Rua A, 123');
  assert.strictEqual(orderFromCorrectStore.body.order.delivery_estimated_time_minutes, 45);

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
  assert.strictEqual(inPreparation.body.order.delivery_estimated_time_minutes, null);

  const cancelledWithoutRefundFlag = await invoke(ordersController.getPublicOrderStatus, {
    params: { id: 'order-cancelled' },
    loja: { id: 'loja-1' }
  });

  assert.strictEqual(cancelledWithoutRefundFlag.statusCode, 200);
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.status, 'cancelado');
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.order_type, 'local');
  assert.strictEqual(cancelledWithoutRefundFlag.body.order.delivery_address, null);
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

  assert.strictEqual(Object.prototype.hasOwnProperty.call(cancelledWithRefundRequested.body.order, 'notes'), false);
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
