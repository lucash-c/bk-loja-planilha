const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `orders-service-modes-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE store_settings (loja_id TEXT UNIQUE, delivery_enabled INTEGER DEFAULT 1, pickup_enabled INTEGER DEFAULT 1, dine_in_enabled INTEGER DEFAULT 1, is_open INTEGER DEFAULT 1)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT, loja_id TEXT, role TEXT, credits NUMERIC, updated_at TEXT)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, customer_whatsapp TEXT, order_type TEXT, delivery_address TEXT, delivery_distance_km NUMERIC, delivery_estimated_time_minutes INTEGER, delivery_fee NUMERIC, total NUMERIC, payment_method TEXT, origin TEXT, payment_status TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE order_jobs (id TEXT PRIMARY KEY, order_id TEXT, loja_id TEXT, job_type TEXT, payload TEXT, status TEXT, attempts INTEGER, max_attempts INTEGER, run_at TEXT, locked_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT)');
}

async function invoke(body) {
  const res = { statusCode: 200, body: null, status(c){this.statusCode=c;return this;}, json(p){this.body=p;return this;} };
  await ordersController.createOrder({ loja: { id: 'loja-1' }, body }, res, err => { if (err) throw err; });
  return res;
}

(async () => {
  await setupSchema();
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'k1', 'Loja', 1]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ul-1', 'u1', 'loja-1', 'owner', 100]);
  await db.query('INSERT INTO store_settings (loja_id, delivery_enabled, pickup_enabled, dine_in_enabled, is_open) VALUES ($1,$2,$3,$4,$5)', ['loja-1', 0, 0, 0, 1]);

  const base = { total: 10, items: [{ product_name: 'Item', quantity: 1, unit_price: 10 }] };
  const d = await invoke({ ...base, order_type: 'entrega' });
  assert.strictEqual(d.statusCode, 400);
  assert.strictEqual(d.body.error, 'Entrega indisponível para esta loja.');

  await db.query('UPDATE store_settings SET pickup_enabled = 1 WHERE loja_id = $1', ['loja-1']);
  const p = await invoke({ ...base, order_type: 'local' });
  assert.strictEqual(p.statusCode, 400);
  assert.strictEqual(p.body.error, 'Comer no local indisponível para esta loja.');

  console.log('Orders service modes integration tests passed');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
}).finally(() => { try { fs.unlinkSync(tempDbPath); } catch (_) {} });
