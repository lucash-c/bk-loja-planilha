const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `orders-transactional-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');
const idempotencyCache = require('../src/services/idempotencyCache');

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT, loja_id TEXT, role TEXT, credits NUMERIC, updated_at TEXT)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, customer_whatsapp TEXT, order_type TEXT, delivery_address TEXT, delivery_distance_km INTEGER, delivery_estimated_time_minutes INTEGER, delivery_fee NUMERIC, total NUMERIC, payment_method TEXT, origin TEXT, payment_status TEXT, status TEXT, notes TEXT, created_at TEXT)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT, created_at TEXT)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER)');
}

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
    return {
      statusCode: nextError.status || 500,
      body: { error: nextError.message }
    };
  }

  return {
    statusCode: res.statusCode,
    body: res.body
  };
}

async function seedStore({ lojaId = 'loja-1', key = 'loja-key', credits = 100 }) {
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', [lojaId, key, 'Loja Teste', 1]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ul-1', 'owner-1', lojaId, 'owner', credits]);
}

async function getCredits(lojaId) {
  const result = await db.query("SELECT credits FROM user_lojas WHERE loja_id = $1 AND role = 'owner'", [lojaId]);
  return Number(result.rows[0].credits);
}

async function run() {
  await setupSchema();
  await seedStore({});

  // retry idempotente não duplica débito
  await db.query("INSERT INTO orders (id, loja_id, total, status, origin) VALUES ($1,$2,$3,$4,$5)", ['o-1', 'loja-1', 10, 'aguardando aceite', 'cliente']);
  idempotencyCache.resetMemoryStore();

  const reqAccept = {
    params: { id: 'o-1' },
    loja: { id: 'loja-1' },
    headers: { 'idempotency-key': 'k-1' },
    body: { actor: 'user-1' }
  };

  const first = await invoke(ordersController.acceptTransactional, reqAccept);
  const second = await invoke(ordersController.acceptTransactional, reqAccept);

  assert.strictEqual(first.statusCode, 200);
  assert.strictEqual(second.statusCode, 200);
  assert.strictEqual(first.body.debited_credits, 1);
  assert.strictEqual(second.body.debited_credits, 1);
  assert.strictEqual(await getCredits('loja-1'), 99);

  // clique duplo/concurrency não duplica operação
  await db.query("INSERT INTO orders (id, loja_id, total, status, origin) VALUES ($1,$2,$3,$4,$5)", ['o-2', 'loja-1', 20, 'aguardando aceite', 'cliente']);
  idempotencyCache.resetMemoryStore();

  const concurrentReq = {
    params: { id: 'o-2' },
    loja: { id: 'loja-1' },
    headers: { 'idempotency-key': 'k-2' },
    body: { actor: 'user-2' }
  };

  const [r1, r2] = await Promise.all([
    invoke(ordersController.acceptTransactional, concurrentReq),
    invoke(ordersController.acceptTransactional, concurrentReq)
  ]);

  assert.ok([200, 409].includes(r1.statusCode));
  assert.ok([200, 409].includes(r2.statusCode));
  const successfulConcurrent = r1.statusCode === 200 ? r1 : r2;
  assert.strictEqual(successfulConcurrent.body.debited_credits, 1);
  assert.strictEqual(await getCredits('loja-1'), 98);

  // falha no meio faz rollback completo (PDV)
  idempotencyCache.resetMemoryStore();
  const beforeRollbackCredits = await getCredits('loja-1');
  const pdvFail = await invoke(ordersController.createPdvTransactional, {
    headers: {
      'x-loja-key': 'loja-key',
      'idempotency-key': 'k-rollback',
      'x-test-force-fail': '1'
    },
    body: {
      external_id: 'pdv-rollback',
      order_type: 'retirada',
      total: 12,
      items: [
        { product_name: 'Produto Teste', quantity: 1, unit_price: 12 }
      ]
    }
  });

  assert.strictEqual(pdvFail.statusCode, 500);
  assert.strictEqual(await getCredits('loja-1'), beforeRollbackCredits);
  const ordersAfterFail = await db.query('SELECT * FROM orders WHERE external_id = $1', ['pdv-rollback']);
  assert.strictEqual(ordersAfterFail.rows.length, 0);

  // payload diferente com mesma chave retorna 409
  idempotencyCache.resetMemoryStore();
  const pdvOk = await invoke(ordersController.createPdvTransactional, {
    headers: { 'x-loja-key': 'loja-key', 'idempotency-key': 'k-mismatch' },
    body: {
      external_id: 'pdv-mismatch-1',
      total: 5,
      items: [{ product_name: 'X', quantity: 1, unit_price: 5 }]
    }
  });
  assert.strictEqual(pdvOk.statusCode, 201);
  assert.strictEqual(pdvOk.body.debited_credits, 1);
  assert.strictEqual(await getCredits('loja-1'), 97);

  const pdvMismatch = await invoke(ordersController.createPdvTransactional, {
    headers: { 'x-loja-key': 'loja-key', 'idempotency-key': 'k-mismatch' },
    body: {
      external_id: 'pdv-mismatch-2',
      total: 8,
      items: [{ product_name: 'Y', quantity: 1, unit_price: 8 }]
    }
  });
  assert.strictEqual(pdvMismatch.statusCode, 409);


  // método de pagamento inválido deve falhar
  const invalidPaymentRes = await invoke(ordersController.createPdvTransactional, {
    headers: { 'x-loja-key': 'loja-key', 'idempotency-key': 'k-payment-invalid' },
    body: {
      external_id: 'pdv-invalid-payment',
      total: 10,
      payment_method: 'pix',
      items: [{ product_name: 'X', quantity: 1, unit_price: 10 }]
    }
  });
  assert.strictEqual(invalidPaymentRes.statusCode, 400);
  assert.match(invalidPaymentRes.body.error, /não está ativa/);

  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, label, is_active) VALUES ($1,$2,$3,$4,$5)', ['pm-1', 'loja-1', 'pix', 'PIX', 1]);
  const validPaymentRes = await invoke(ordersController.createPdvTransactional, {
    headers: { 'x-loja-key': 'loja-key', 'idempotency-key': 'k-payment-valid' },
    body: {
      external_id: 'pdv-valid-payment',
      total: 10,
      payment_method: 'pix',
      items: [{ product_name: 'X', quantity: 1, unit_price: 10 }]
    }
  });
  assert.strictEqual(validPaymentRes.statusCode, 201);
  assert.strictEqual(await getCredits('loja-1'), 96);

  console.log('All transactional integration tests passed');
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
