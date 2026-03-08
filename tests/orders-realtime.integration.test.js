const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempDbPath = path.join(os.tmpdir(), `orders-realtime-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = 'test-secret';
process.env.ORDERS_REALTIME_ENABLED = 'true';

const db = require('../src/config/db');
const { createApp } = require('../src/index');

async function setupSchema() {
  await db.query('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, role TEXT)');
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, name TEXT, public_key TEXT, is_active INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT, loja_id TEXT, role TEXT, credits NUMERIC)');
  await db.query('CREATE TABLE store_settings (id TEXT PRIMARY KEY, loja_id TEXT, is_open INTEGER, orders_realtime_enabled INTEGER)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, customer_whatsapp TEXT, total NUMERIC, status TEXT, payment_status TEXT, created_at TEXT)');
}

async function seedData() {
  await db.query('INSERT INTO users (id, email, name, role) VALUES ($1,$2,$3,$4)', ['u-1', 'u1@mail.com', 'User 1', 'admin']);
  await db.query('INSERT INTO users (id, email, name, role) VALUES ($1,$2,$3,$4)', ['u-2', 'u2@mail.com', 'User 2', 'admin']);

  await db.query('INSERT INTO lojas (id, name, public_key, is_active, created_at) VALUES ($1,$2,$3,$4,$5)', ['loja-a', 'Loja A', 'key-a', 1, new Date().toISOString()]);
  await db.query('INSERT INTO lojas (id, name, public_key, is_active, created_at) VALUES ($1,$2,$3,$4,$5)', ['loja-b', 'Loja B', 'key-b', 1, new Date().toISOString()]);

  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ul-a', 'u-1', 'loja-a', 'owner', 100]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ul-b', 'u-2', 'loja-b', 'owner', 100]);

  await db.query('INSERT INTO store_settings (id, loja_id, is_open, orders_realtime_enabled) VALUES ($1,$2,$3,$4)', ['ss-a', 'loja-a', 1, 1]);
  await db.query('INSERT INTO store_settings (id, loja_id, is_open, orders_realtime_enabled) VALUES ($1,$2,$3,$4)', ['ss-b', 'loja-b', 1, 0]);

  const createdAt = new Date().toISOString();
  await db.query('INSERT INTO orders (id, loja_id, customer_name, total, status, payment_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['order-a', 'loja-a', 'Cliente A', 35.5, 'new', 'pending', createdAt]);
  await db.query('INSERT INTO orders (id, loja_id, customer_name, total, status, payment_status, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['order-b', 'loja-b', 'Cliente B', 99, 'new', 'pending', createdAt]);
}

function storeToken(userId, lojaId) {
  return jwt.sign({ sub: userId, loja_id: lojaId, type: 'store' }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

function parseSseChunk(buffer, chunk) {
  buffer.value += chunk;
  const events = [];

  while (true) {
    const separatorIndex = buffer.value.indexOf('\n\n');
    if (separatorIndex < 0) break;
    const raw = buffer.value.slice(0, separatorIndex);
    buffer.value = buffer.value.slice(separatorIndex + 2);

    const parsed = { event: 'message', data: null, id: null };
    for (const line of raw.split('\n')) {
      if (line.startsWith('event:')) parsed.event = line.slice(6).trim();
      if (line.startsWith('id:')) parsed.id = line.slice(3).trim();
      if (line.startsWith('data:')) parsed.data = JSON.parse(line.slice(5).trim());
    }

    events.push(parsed);
  }

  return events;
}

async function waitForOrderEvent(reader, timeoutMs = 3000) {
  const timeoutAt = Date.now() + timeoutMs;
  const decoder = new TextDecoder();
  const buffer = { value: '' };

  while (Date.now() < timeoutAt) {
    const read = await Promise.race([
      reader.read(),
      new Promise(resolve => setTimeout(() => resolve({ timeout: true }), 100))
    ]);

    if (read.timeout) continue;
    if (read.done) return null;

    const text = decoder.decode(read.value, { stream: true });
    const events = parseSseChunk(buffer, text);
    const found = events.find(evt => evt.event === 'order_event');
    if (found) return found;
  }

  return null;
}

async function run() {
  await setupSchema();
  await seedData();

  const app = createApp();
  const server = app.listen(0);
  const port = server.address().port;

  const tokenA = storeToken('u-1', 'loja-a');
  const tokenB = storeToken('u-2', 'loja-b');

  // auth inválida
  const invalidAuthRes = await fetch(`http://127.0.0.1:${port}/api/orders/stream`, {
    headers: { Authorization: 'Bearer invalid' }
  });
  assert.strictEqual(invalidAuthRes.status, 401);

  const streamA = await fetch(`http://127.0.0.1:${port}/api/orders/stream`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(streamA.status, 200);

  const streamBDisabled = await fetch(`http://127.0.0.1:${port}/api/orders/stream`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(streamBDisabled.status, 503);

  const pollingFallback = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    headers: { Authorization: `Bearer ${tokenB}` }
  });
  assert.strictEqual(pollingFallback.status, 200);

  const readerA = streamA.body.getReader();

  // mutação em A gera evento com contrato mínimo
  const updateA = await fetch(`http://127.0.0.1:${port}/api/orders/order-a/status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'em preparo' })
  });
  assert.strictEqual(updateA.status, 200);

  const eventA = await waitForOrderEvent(readerA);
  assert.ok(eventA, 'deveria receber evento para loja A');
  assert.strictEqual(eventA.data.type, 'order.updated');
  assert.ok(['order.created', 'order.updated', 'order.deleted'].includes(eventA.data.type));
  assert.strictEqual(eventA.data.payload.id, 'order-a');
  assert.strictEqual(eventA.data.payload.status, 'em preparo');
  assert.ok(eventA.data.payload.created_at);
  assert.ok(eventA.data.payload.customer);
  assert.ok(eventA.data.payload.customer.name);
  assert.ok(Object.prototype.hasOwnProperty.call(eventA.data.payload, 'total'));

  // isolamento: mutação em B não chega em A
  const updateB = await fetch(`http://127.0.0.1:${port}/api/orders/order-b/status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenB}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'cancelado' })
  });
  assert.strictEqual(updateB.status, 200);

  const leakedEvent = await waitForOrderEvent(readerA, 700);
  assert.strictEqual(leakedEvent, null, 'loja A não deve receber evento da loja B');

  // reconciliação via polling após queda
  await readerA.cancel();

  const updateA2 = await fetch(`http://127.0.0.1:${port}/api/orders/order-a/status`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ status: 'entregue' })
  });
  assert.strictEqual(updateA2.status, 200);

  const reconciliation = await fetch(`http://127.0.0.1:${port}/api/orders`, {
    headers: { Authorization: `Bearer ${tokenA}` }
  });
  assert.strictEqual(reconciliation.status, 200);
  const reconciliationOrders = await reconciliation.json();
  const orderA = reconciliationOrders.find(order => order.id === 'order-a');
  assert.strictEqual(orderA.status, 'entregue');

  server.close();
  console.log('Orders realtime integration tests passed');
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
