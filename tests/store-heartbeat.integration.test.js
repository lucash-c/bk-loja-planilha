const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `store-heartbeat-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const storeSettingsController = require('../src/controllers/storeSettingsController');
const storeSettingsRoutes = require('../src/routes/storeSettings');
const { closeInactiveStores } = require('../src/services/storeHeartbeatService');

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
  await db.query(`
    CREATE TABLE store_settings (
      id TEXT PRIMARY KEY,
      loja_id TEXT UNIQUE,
      is_open INTEGER DEFAULT 1,
      last_pdv_heartbeat_at TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function run() {
  await setupSchema();

  const heartbeatRes = await invoke(storeSettingsController.heartbeat, {
    loja: { id: 'loja-heartbeat' }
  });

  assert.strictEqual(heartbeatRes.statusCode, 200);
  const heartbeatStored = await db.query('SELECT last_pdv_heartbeat_at FROM store_settings WHERE loja_id = $1', ['loja-heartbeat']);
  assert.strictEqual(heartbeatStored.rows.length, 1);
  assert.ok(heartbeatStored.rows[0].last_pdv_heartbeat_at);

  await db.query(`INSERT INTO store_settings (id, loja_id, is_open, last_pdv_heartbeat_at) VALUES ('1', 'loja-recente', 1, datetime('now'))`);
  const recentResult = await closeInactiveStores();
  assert.strictEqual(recentResult.updated, 0);
  const recentStore = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-recente']);
  assert.strictEqual(recentStore.rows[0].is_open, 1);

  await db.query(`INSERT INTO store_settings (id, loja_id, is_open, last_pdv_heartbeat_at) VALUES ('2', 'loja-antiga', 1, datetime('now', '-20 minutes'))`);
  const closeResult = await closeInactiveStores();
  assert.ok(closeResult.updated >= 1);
  const oldStore = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-antiga']);
  assert.strictEqual(oldStore.rows[0].is_open, 0);

  await db.query(`INSERT INTO store_settings (id, loja_id, is_open, last_pdv_heartbeat_at, updated_at) VALUES ('4', 'loja-null-recente', 1, NULL, datetime('now'))`);
  const nullRecentResult = await closeInactiveStores();
  assert.strictEqual(nullRecentResult.updated, 0);
  const nullRecentStore = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-null-recente']);
  assert.strictEqual(nullRecentStore.rows[0].is_open, 1);

  await db.query(`INSERT INTO store_settings (id, loja_id, is_open, last_pdv_heartbeat_at, updated_at) VALUES ('5', 'loja-null-antiga', 1, NULL, datetime('now', '-20 minutes'))`);
  const nullOldResult = await closeInactiveStores();
  assert.ok(nullOldResult.updated >= 1);
  const nullOldStore = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-null-antiga']);
  assert.strictEqual(nullOldStore.rows[0].is_open, 0);

  await db.query(`INSERT INTO store_settings (id, loja_id, is_open, last_pdv_heartbeat_at) VALUES ('3', 'loja-fechada', 0, datetime('now', '-20 minutes'))`);
  await closeInactiveStores();
  const closedStore = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-fechada']);
  assert.strictEqual(closedStore.rows[0].is_open, 0);

  const heartbeatRouteLayer = storeSettingsRoutes.stack.find(layer => layer.route?.path === '/heartbeat');
  assert.ok(heartbeatRouteLayer);
  const middlewareNames = heartbeatRouteLayer.route.stack.map(layer => layer.name);
  assert.ok(middlewareNames.includes('authenticate'));

  console.log('Store heartbeat integration tests passed');
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
