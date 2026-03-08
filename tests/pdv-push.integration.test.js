const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');
const Module = require('module');

const tempDbPath = path.join(os.tmpdir(), `pdv-push-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = 'test-secret';
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'test-public';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'test-private';
process.env.WEB_PUSH_SUBJECT = 'mailto:test@example.com';

let sendMode = 'success';
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'web-push') {
    return {
      setVapidDetails: () => {},
      sendNotification: async () => {
        if (sendMode === '410') {
          const err = new Error('subscription gone');
          err.statusCode = 410;
          throw err;
        }
        return { statusCode: 201 };
      }
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

const db = require('../src/config/db');
const { createApp } = require('../src/index');
const { processOrderPushJob } = require('../src/services/pushNotificationService');

async function setupSchema() {
  await db.query('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT)');
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT, name TEXT, is_active INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT, loja_id TEXT, role TEXT, credits NUMERIC)');
  await db.query('CREATE TABLE store_settings (id TEXT PRIMARY KEY, loja_id TEXT, is_open INTEGER, orders_realtime_enabled INTEGER)');
  await db.query(`CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    loja_id TEXT,
    external_id TEXT,
    customer_name TEXT,
    customer_whatsapp TEXT,
    order_type TEXT,
    delivery_address TEXT,
    delivery_distance_km NUMERIC,
    delivery_fee NUMERIC,
    delivery_estimated_time_minutes INTEGER,
    total NUMERIC,
    payment_method TEXT,
    origin TEXT,
    notes TEXT,
    payment_status TEXT,
    status TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query('CREATE TABLE order_items (id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT)');
  await db.query(`CREATE TABLE order_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT,
    loja_id TEXT,
    job_type TEXT,
    status TEXT DEFAULT 'pending',
    payload TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 5,
    last_error TEXT,
    run_at TEXT DEFAULT CURRENT_TIMESTAMP,
    locked_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await db.query(`CREATE TABLE pdv_push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(loja_id, endpoint)
  )`);
  await db.query(`CREATE TABLE order_push_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subscription_id INTEGER NOT NULL,
    status TEXT DEFAULT 'sent',
    provider_status_code INTEGER,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, event_type, subscription_id)
  )`);
}

async function seedData() {
  await db.query('INSERT INTO users (id, email, name, role) VALUES ($1,$2,$3,$4)', ['u-a', 'a@mail.com', 'A', 'admin']);
  await db.query('INSERT INTO users (id, email, name, role) VALUES ($1,$2,$3,$4)', ['u-b', 'b@mail.com', 'B', 'admin']);
  await db.query('INSERT INTO lojas (id, public_key, name, is_active, created_at) VALUES ($1,$2,$3,$4,$5)', ['loja-a', 'key-a', 'Loja A', 1, new Date().toISOString()]);
  await db.query('INSERT INTO lojas (id, public_key, name, is_active, created_at) VALUES ($1,$2,$3,$4,$5)', ['loja-b', 'key-b', 'Loja B', 1, new Date().toISOString()]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ula', 'u-a', 'loja-a', 'owner', 100]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ulb', 'u-b', 'loja-b', 'owner', 100]);
}

function storeToken(userId, lojaId) {
  return jwt.sign({ sub: userId, loja_id: lojaId, type: 'store' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

async function run() {
  await setupSchema();
  await seedData();

  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  const tokenA = storeToken('u-a', 'loja-a');
  const tokenB = storeToken('u-b', 'loja-b');

  const subRes = await fetch(`http://127.0.0.1:${port}/api/pdv/push-subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ endpoint: 'https://push.example/sub-a', p256dh: 'key-a', auth: 'auth-a' })
  });
  assert.strictEqual(subRes.status, 201);
  const subBody = await subRes.json();
  assert.ok(subBody.id);

  const badRes = await fetch(`http://127.0.0.1:${port}/api/pdv/push-subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ endpoint: '', p256dh: 'x', auth: 'y' })
  });
  assert.strictEqual(badRes.status, 400);

  const subResB = await fetch(`http://127.0.0.1:${port}/api/pdv/push-subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenB}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ endpoint: 'https://push.example/sub-b', p256dh: 'key-b', auth: 'auth-b' })
  });
  assert.strictEqual(subResB.status, 201);

  const forbiddenDelete = await fetch(`http://127.0.0.1:${port}/api/pdv/push-subscriptions/${subBody.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(forbiddenDelete.status, 404);

  const createOrderRes = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    method: 'POST',
    headers: {
      'X-LOJA-KEY': 'key-a',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      customer_name: 'Cliente push',
      total: 10,
      items: [{ product_name: 'Pizza', quantity: 1, unit_price: 10 }]
    })
  });
  assert.strictEqual(createOrderRes.status, 201);
  const orderPayload = await createOrderRes.json();
  const orderId = orderPayload.order.id;

  const pushJobs = await db.query('SELECT * FROM order_jobs WHERE order_id = $1 AND job_type = $2', [orderId, 'order_push_notification']);
  assert.strictEqual(pushJobs.rows.length, 1, 'deve enfileirar job de push em order.created');

  const updateStatusRes = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}/status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'em preparo' })
  });
  assert.strictEqual(updateStatusRes.status, 200);

  const updateJobs = await db.query('SELECT * FROM order_jobs WHERE order_id = $1 AND job_type = $2 ORDER BY id DESC', [orderId, 'order_push_notification']);
  const updateJob = updateJobs.rows[0];

  await processOrderPushJob(updateJob);
  await processOrderPushJob(updateJob);

  const deliveries = await db.query('SELECT * FROM order_push_deliveries WHERE order_id = $1 AND event_type = $2', [orderId, 'order.updated']);
  assert.strictEqual(deliveries.rows.length, 1, 'não deve duplicar entrega em reprocessamento');

  const deliverySub = deliveries.rows[0].subscription_id;
  const subRow = await db.query('SELECT loja_id FROM pdv_push_subscriptions WHERE id = $1', [deliverySub]);
  assert.strictEqual(subRow.rows[0].loja_id, 'loja-a', 'deve manter isolamento entre lojas');

  sendMode = '410';
  await processOrderPushJob(pushJobs.rows[0]);
  const revoked = await db.query('SELECT enabled FROM pdv_push_subscriptions WHERE id = $1', [subBody.id]);
  assert.strictEqual(Number(revoked.rows[0].enabled), 0, 'deve revogar subscription em erro 410');

  server.close();
  console.log('PDV push integration tests passed');
}

run()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
    try {
      fs.unlinkSync(tempDbPath);
    } catch (_) {}
  });
