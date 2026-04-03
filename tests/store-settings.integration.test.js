const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `store-settings-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const storeSettingsController = require('../src/controllers/storeSettingsController');

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
      mercado_pago_access_token TEXT,
      pix_key TEXT,
      pix_qr_image TEXT,
      open_time TEXT,
      close_time TEXT,
      is_open INTEGER,
      updated_at TEXT
    )
  `);
}

async function run() {
  await setupSchema();

  const ownerPut = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: '  APP_USR-token-loja-a  ',
      pix_qr_image: 'qr-base64',
      open_time: '08:00',
      close_time: '22:00',
      is_open: true
    }
  });

  assert.strictEqual(ownerPut.statusCode, 200);

  const storedA = await db.query('SELECT * FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(storedA.rows.length, 1);
  assert.strictEqual(storedA.rows[0].mercado_pago_access_token, 'APP_USR-token-loja-a');

  const ownerGetA = await invoke(storeSettingsController.getSettings, {
    loja: { id: 'loja-a' }
  });

  assert.strictEqual(ownerGetA.statusCode, 200);
  assert.strictEqual(ownerGetA.body.mercado_pago_access_token, 'APP_USR-token-loja-a');
  assert.strictEqual(ownerGetA.body.pix_key, null);

  const ownerPutB = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-b' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: 'APP_USR-token-loja-b',
      is_open: false
    }
  });
  assert.strictEqual(ownerPutB.statusCode, 200);

  const ownerGetB = await invoke(storeSettingsController.getSettings, {
    loja: { id: 'loja-b' }
  });

  assert.strictEqual(ownerGetB.body.mercado_pago_access_token, 'APP_USR-token-loja-b');
  assert.notStrictEqual(ownerGetA.body.mercado_pago_access_token, ownerGetB.body.mercado_pago_access_token);

  const forbidden = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'manager' },
    body: {
      mercado_pago_access_token: 'APP_USR-nao-deve-gravar'
    }
  });

  assert.strictEqual(forbidden.statusCode, 403);

  const afterForbidden = await db.query('SELECT mercado_pago_access_token FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(afterForbidden.rows[0].mercado_pago_access_token, 'APP_USR-token-loja-a');

  console.log('Store settings integration tests passed');
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
