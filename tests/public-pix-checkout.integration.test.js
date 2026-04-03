const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `public-pix-checkout-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;
process.env.PAYMENTS_API_BASE_URL = 'http://payments.local';

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');

const paymentSnapshots = new Map();
let paymentCounter = 0;

const originalFetch = global.fetch;
global.fetch = async (url, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();

  if (method === 'POST' && String(url).includes('/api/payments/pix/intents')) {
    const body = JSON.parse(options.body || '{}');
    paymentCounter += 1;
    const paymentId = `pay-${paymentCounter}`;

    paymentSnapshots.set(paymentId, {
      payment_id: paymentId,
      loja_id: body.loja_id,
      correlation_id: body.correlation_id,
      status: 'pending'
    });

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        payment_id: paymentId,
        correlation_id: body.correlation_id,
        pix: {
          txid: `tx-${paymentCounter}`,
          qr_code_text: `pix-code-${paymentCounter}`
        }
      })
    };
  }

  if (method === 'GET' && String(url).includes('/api/payments/')) {
    const pathPart = String(url).split('/api/payments/')[1] || '';
    const paymentId = decodeURIComponent(pathPart.split('?')[0]);
    const snapshot = paymentSnapshots.get(paymentId);

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(snapshot || {
        payment_id: paymentId,
        loja_id: 'unknown',
        status: 'not_found'
      })
    };
  }

  throw new Error(`unexpected fetch call ${method} ${url}`);
};

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

  if (nextError) {
    throw nextError;
  }

  return res;
}

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, customer_whatsapp TEXT, order_type TEXT, delivery_address TEXT, delivery_distance_km NUMERIC, delivery_estimated_time_minutes INTEGER, delivery_fee NUMERIC, total NUMERIC, payment_method TEXT, origin TEXT, payment_status TEXT, status TEXT, notes TEXT, created_at TEXT)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT, created_at TEXT)');
  await db.query('CREATE TABLE order_jobs (id TEXT PRIMARY KEY, order_id TEXT, loja_id TEXT, job_type TEXT, payload TEXT)');
  await db.query('CREATE TABLE public_pix_checkout_sessions (id TEXT PRIMARY KEY, loja_id TEXT, public_key TEXT, correlation_id TEXT, payment_id TEXT, txid TEXT, raw_order_payload TEXT, amount NUMERIC, payment_method TEXT, status TEXT, order_id TEXT, created_at TEXT, updated_at TEXT)');
}

async function seedStore(lojaId, publicKey) {
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', [lojaId, publicKey, `Loja ${lojaId}`, 1]);
  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, label, is_active) VALUES ($1,$2,$3,$4,$5)', [`pm-${lojaId}-pix`, lojaId, 'pix', 'PIX', 1]);
  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, label, is_active) VALUES ($1,$2,$3,$4,$5)', [`pm-${lojaId}-dinheiro`, lojaId, 'dinheiro', 'Dinheiro', 1]);
}

function makePixPayload(extra = {}) {
  return {
    customer_name: 'Cliente Teste',
    payment_method: 'pix',
    total: 30,
    items: [{ product_name: 'Pizza', quantity: 1, unit_price: 30 }],
    ...extra
  };
}

async function run() {
  await setupSchema();
  await seedStore('loja-a', 'pub-a');
  await seedStore('loja-b', 'pub-b');

  const pixPending = await invoke(ordersController.createOrder, {
    loja: { id: 'loja-a' },
    headers: { 'x-loja-key': 'pub-a' },
    query: {},
    body: makePixPayload()
  });

  assert.strictEqual(pixPending.statusCode, 202);
  assert.strictEqual(pixPending.body.checkout_session.status, 'pending');
  const sessionId = pixPending.body.checkout_session.id;
  const paymentId = pixPending.body.pix.payment_id;

  const ordersBeforeApproval = await db.query('SELECT * FROM orders WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(ordersBeforeApproval.rows.length, 0);

  const sessionRow = await db.query('SELECT * FROM public_pix_checkout_sessions WHERE id = $1 AND loja_id = $2', [sessionId, 'loja-a']);
  assert.strictEqual(sessionRow.rows.length, 1);
  assert.strictEqual(sessionRow.rows[0].status, 'pending');

  paymentSnapshots.set(paymentId, {
    payment_id: paymentId,
    loja_id: 'loja-a',
    correlation_id: sessionRow.rows[0].correlation_id,
    status: 'approved'
  });

  const callbackApproved = await invoke(ordersController.handlePixPaymentCallback, {
    body: {
      loja_id: 'loja-a',
      payment_id: paymentId,
      correlation_id: sessionRow.rows[0].correlation_id
    }
  });

  assert.strictEqual(callbackApproved.statusCode, 200);
  assert.strictEqual(callbackApproved.body.converted, true);

  const ordersAfterApproval = await db.query('SELECT * FROM orders WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(ordersAfterApproval.rows.length, 1);

  const callbackDuplicate = await invoke(ordersController.handlePixPaymentCallback, {
    body: {
      loja_id: 'loja-a',
      payment_id: paymentId,
      correlation_id: sessionRow.rows[0].correlation_id
    }
  });
  assert.strictEqual(callbackDuplicate.statusCode, 200);

  const ordersAfterDuplicate = await db.query('SELECT * FROM orders WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(ordersAfterDuplicate.rows.length, 1);

  const notApprovedSession = await invoke(ordersController.createOrder, {
    loja: { id: 'loja-a' },
    headers: { 'x-loja-key': 'pub-a' },
    query: {},
    body: makePixPayload({ external_id: 'pix-2' })
  });
  const notApprovedPaymentId = notApprovedSession.body.pix.payment_id;
  const notApprovedSessionRow = await db.query('SELECT * FROM public_pix_checkout_sessions WHERE id = $1', [notApprovedSession.body.checkout_session.id]);
  paymentSnapshots.set(notApprovedPaymentId, {
    payment_id: notApprovedPaymentId,
    loja_id: 'loja-a',
    correlation_id: notApprovedSessionRow.rows[0].correlation_id,
    status: 'pending'
  });

  const callbackPending = await invoke(ordersController.handlePixPaymentCallback, {
    body: {
      loja_id: 'loja-a',
      payment_id: notApprovedPaymentId,
      correlation_id: notApprovedSessionRow.rows[0].correlation_id
    }
  });
  assert.strictEqual(callbackPending.statusCode, 202);

  const divergentSession = await invoke(ordersController.createOrder, {
    loja: { id: 'loja-a' },
    headers: { 'x-loja-key': 'pub-a' },
    query: {},
    body: makePixPayload({ external_id: 'pix-3' })
  });
  const divergentPaymentId = divergentSession.body.pix.payment_id;
  const divergentRow = await db.query('SELECT * FROM public_pix_checkout_sessions WHERE id = $1', [divergentSession.body.checkout_session.id]);

  paymentSnapshots.set(divergentPaymentId, {
    payment_id: divergentPaymentId,
    loja_id: 'loja-b',
    correlation_id: divergentRow.rows[0].correlation_id,
    status: 'approved'
  });

  const callbackDivergent = await invoke(ordersController.handlePixPaymentCallback, {
    body: {
      loja_id: 'loja-a',
      payment_id: divergentPaymentId,
      correlation_id: divergentRow.rows[0].correlation_id
    }
  });
  assert.strictEqual(callbackDivergent.statusCode, 409);

  const lojaBSession = await invoke(ordersController.createOrder, {
    loja: { id: 'loja-b' },
    headers: { 'x-loja-key': 'pub-b' },
    query: {},
    body: makePixPayload({ external_id: 'pix-b' })
  });

  const crossTenant = await invoke(ordersController.handlePixPaymentCallback, {
    body: {
      loja_id: 'loja-a',
      payment_id: lojaBSession.body.pix.payment_id
    }
  });
  assert.strictEqual(crossTenant.statusCode, 202);

  const lojaBOrders = await db.query('SELECT * FROM orders WHERE loja_id = $1', ['loja-b']);
  assert.strictEqual(lojaBOrders.rows.length, 0);

  const nonPix = await invoke(ordersController.createOrder, {
    loja: { id: 'loja-a' },
    headers: { 'x-loja-key': 'pub-a' },
    query: {},
    body: {
      customer_name: 'Cliente Dinheiro',
      payment_method: 'dinheiro',
      total: 10,
      items: [{ product_name: 'Água', quantity: 1, unit_price: 10 }]
    }
  });
  assert.strictEqual(nonPix.statusCode, 201);

  const originalBaseUrl = process.env.PAYMENTS_API_BASE_URL;
  delete process.env.PAYMENTS_API_BASE_URL;
  const missingEnv = await invoke(ordersController.createOrder, {
    loja: { id: 'loja-a' },
    headers: { 'x-loja-key': 'pub-a' },
    query: {},
    body: makePixPayload({ external_id: 'pix-sem-env' })
  });
  process.env.PAYMENTS_API_BASE_URL = originalBaseUrl;
  assert.strictEqual(missingEnv.statusCode, 500);
  assert.match(missingEnv.body.error, /PAYMENTS_API_BASE_URL/);

  console.log('Public PIX checkout integration tests passed');
}

run()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
    try {
      fs.unlinkSync(tempDbPath);
    } catch (_) {}
  });
