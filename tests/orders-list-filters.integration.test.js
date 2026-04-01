const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `orders-list-filters-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, status TEXT, created_at TEXT)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, options_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
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

async function seedOrder({ id, lojaId = 'loja-1', externalId, customerName, status, createdAt }) {
  await db.query(
    'INSERT INTO orders (id, loja_id, external_id, customer_name, status, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, lojaId, externalId, customerName, status, createdAt]
  );
}

async function seedItem({ id, orderId, productName = 'Produto', quantity = 1, unitPrice = 10 }) {
  await db.query(
    'INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price, options_json) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, orderId, productName, quantity, unitPrice, quantity * unitPrice, null]
  );
}

async function run() {
  await setupSchema();
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'key-1', 'Loja Teste', 1]);

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

  await seedOrder({ id: 'o-open-today', externalId: 'A1', customerName: 'Alice', status: 'em preparo', createdAt: twoHoursAgo });
  await seedOrder({ id: 'o-cancel-today', externalId: 'A2', customerName: 'Bob', status: 'cancelado', createdAt: twoHoursAgo });
  await seedOrder({ id: 'o-open-yesterday', externalId: 'A3', customerName: 'Carol', status: 'aguardando aceite', createdAt: yesterday });
  await seedOrder({ id: 'o-old', externalId: 'A4', customerName: 'Daniel', status: 'entregue', createdAt: threeDaysAgo });

  await seedItem({ id: 'i-1', orderId: 'o-open-today', productName: 'Pizza' });

  const listNoItemsRes = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: {}
  });
  assert.strictEqual(listNoItemsRes.statusCode, 200);
  assert.ok(Array.isArray(listNoItemsRes.body));
  assert.ok(listNoItemsRes.body.length >= 4);
  assert.strictEqual(listNoItemsRes.body[0].items, undefined);

  const listWithItemsRes = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: { include: 'items' }
  });
  assert.strictEqual(listWithItemsRes.statusCode, 200);
  const orderWithItems = listWithItemsRes.body.find(order => order.id === 'o-open-today');
  assert.ok(orderWithItems);
  assert.ok(Array.isArray(orderWithItems.items));
  assert.strictEqual(orderWithItems.items.length, 1);

  const onlyTodayRes = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: { only_today: 'true' }
  });
  assert.strictEqual(onlyTodayRes.statusCode, 200);
  assert.ok(onlyTodayRes.body.every(order => order.id !== 'o-open-yesterday' && order.id !== 'o-old'));

  const onlyOpenRes = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: { only_open: 'true' }
  });
  assert.strictEqual(onlyOpenRes.statusCode, 200);
  assert.ok(onlyOpenRes.body.every(order => !['cancelado', 'entregue'].includes((order.status || '').toLowerCase())));

  const createdAfterRes = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: { created_after: yesterday }
  });
  assert.strictEqual(createdAfterRes.statusCode, 200);
  assert.ok(createdAfterRes.body.every(order => new Date(order.created_at).getTime() >= new Date(yesterday).getTime()));
  assert.ok(createdAfterRes.body.find(order => order.id === 'o-open-today'));

  console.log('All order list filter integration tests passed');
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
