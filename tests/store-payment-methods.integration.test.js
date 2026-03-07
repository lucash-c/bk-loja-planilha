const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `store-payment-methods-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const controller = require('../src/controllers/storePaymentMethodsController');

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
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT NOT NULL, code TEXT NOT NULL, label TEXT NOT NULL, is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0, requires_change INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE (loja_id, code))');
}

async function run() {
  await setupSchema();

  const unauthorizedRes = await invoke(controller.createPaymentMethod, {
    loja: { id: 'loja-1' },
    userLoja: { role: 'staff' },
    body: { code: 'pix', label: 'PIX' }
  });
  assert.strictEqual(unauthorizedRes.statusCode, 403);

  const createdPix = await invoke(controller.createPaymentMethod, {
    loja: { id: 'loja-1' },
    userLoja: { role: 'owner' },
    body: { code: 'pix', label: 'PIX', sort_order: 2 }
  });
  assert.strictEqual(createdPix.statusCode, 201);

  const createdCash = await invoke(controller.createPaymentMethod, {
    loja: { id: 'loja-1' },
    userLoja: { role: 'owner' },
    body: { code: 'dinheiro', label: 'Dinheiro', sort_order: 1, requires_change: true }
  });
  assert.strictEqual(createdCash.statusCode, 201);

  const duplicateRes = await invoke(controller.createPaymentMethod, {
    loja: { id: 'loja-1' },
    userLoja: { role: 'owner' },
    body: { code: 'pix', label: 'Pix duplicado' }
  });
  assert.strictEqual(duplicateRes.statusCode, 409);

  const listRes = await invoke(controller.listPaymentMethods, {
    loja: { id: 'loja-1' }
  });
  assert.strictEqual(listRes.statusCode, 200);
  assert.deepStrictEqual(listRes.body.payment_methods.map(item => item.code), ['dinheiro', 'pix']);

  const pixId = createdPix.body.payment_method.id;
  const updateRes = await invoke(controller.updatePaymentMethod, {
    loja: { id: 'loja-1' },
    userLoja: { role: 'owner' },
    params: { id: pixId },
    body: { label: 'Pix QR', sort_order: 0 }
  });
  assert.strictEqual(updateRes.statusCode, 200);
  assert.strictEqual(updateRes.body.payment_method.label, 'Pix QR');

  const deleteRes = await invoke(controller.deletePaymentMethod, {
    loja: { id: 'loja-1' },
    userLoja: { role: 'owner' },
    params: { id: pixId }
  });
  assert.strictEqual(deleteRes.statusCode, 200);
  assert.strictEqual(deleteRes.body.payment_method.is_active, 0);

  const listAfterDelete = await invoke(controller.listPaymentMethods, {
    loja: { id: 'loja-1' }
  });
  const pixAfterDelete = listAfterDelete.body.payment_methods.find(item => item.id === pixId);
  assert.strictEqual(pixAfterDelete.is_active, 0);

  console.log('Store payment methods integration tests passed');
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
