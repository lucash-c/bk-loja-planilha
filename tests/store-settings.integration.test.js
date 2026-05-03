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
      last_pdv_heartbeat_at TEXT,
      delivery_enabled INTEGER DEFAULT 1,
      pickup_enabled INTEGER DEFAULT 1,
      dine_in_enabled INTEGER DEFAULT 1,
      updated_at TEXT
    )
  `);
  await db.query('CREATE TABLE store_delivery_fees (loja_id TEXT, distance_km NUMERIC, fee NUMERIC, estimated_time_minutes INTEGER)');
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, cep TEXT, rua TEXT, numero TEXT, bairro TEXT, estado TEXT, pais TEXT)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE categories (id TEXT PRIMARY KEY, loja_id TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE products (id TEXT PRIMARY KEY, loja_id TEXT, category_id TEXT, is_active INTEGER, is_visible INTEGER)');
}

async function run() {
  await setupSchema();
  await db.query('INSERT INTO lojas (id, cep, rua, numero, bairro, estado, pais) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['loja-a', '01000-000', 'Rua A', '10', 'Centro', 'SP', 'Brasil']);
  await db.query('INSERT INTO lojas (id) VALUES ($1)', ['loja-b']);
  await db.query('INSERT INTO store_delivery_fees (loja_id, distance_km, fee) VALUES ($1,$2,$3)', ['loja-a', 5, 9.9]);
  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, is_active) VALUES ($1,$2,$3,$4)', ['pm-1', 'loja-a', 'dinheiro', 1]);
  await db.query('INSERT INTO categories (id, loja_id, is_active) VALUES ($1,$2,$3)', ['cat-1', 'loja-a', 1]);
  await db.query('INSERT INTO products (id, loja_id, category_id, is_active, is_visible) VALUES ($1,$2,$3,$4,$5)', ['prod-1', 'loja-a', 'cat-1', 1, 1]);

  const ownerPut = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: '  APP_USR-token-loja-a  ',
      pix_qr_image: 'qr-base64',
      open_time: '08:00',
      close_time: '22:00',
      is_open: true,
      delivery_enabled: true,
      pickup_enabled: true,
      dine_in_enabled: true
    }
  });

  assert.strictEqual(ownerPut.statusCode, 200);

  const storedA = await db.query('SELECT * FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(storedA.rows.length, 1);
  assert.strictEqual(storedA.rows[0].mercado_pago_access_token, 'APP_USR-token-loja-a');
  assert.strictEqual(storedA.rows[0].is_open, 1);
  assert.ok(storedA.rows[0].last_pdv_heartbeat_at);

  const keepOpenWithoutIsOpen = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: 'APP_USR-token-loja-a',
      open_time: '08:00',
      close_time: '22:00',
      delivery_enabled: true,
      pickup_enabled: true,
      dine_in_enabled: true
    }
  });
  assert.strictEqual(keepOpenWithoutIsOpen.statusCode, 200);
  const lojaAAfterMissingIsOpenOpen = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(lojaAAfterMissingIsOpenOpen.rows[0].is_open, 1);

  const explicitClose = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: 'APP_USR-token-loja-a',
      is_open: false,
      delivery_enabled: true,
      pickup_enabled: true,
      dine_in_enabled: true
    }
  });
  assert.strictEqual(explicitClose.statusCode, 200);
  const lojaAAfterExplicitClose = await db.query('SELECT is_open, last_pdv_heartbeat_at FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(lojaAAfterExplicitClose.rows[0].is_open, 0);
  assert.ok(lojaAAfterExplicitClose.rows[0].last_pdv_heartbeat_at);

  const keepClosedWithoutIsOpen = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: 'APP_USR-token-loja-a',
      open_time: '08:00',
      close_time: '22:00',
      delivery_enabled: true,
      pickup_enabled: true,
      dine_in_enabled: true
    }
  });
  assert.strictEqual(keepClosedWithoutIsOpen.statusCode, 200);
  const lojaAAfterMissingIsOpenClosed = await db.query('SELECT is_open FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(lojaAAfterMissingIsOpenClosed.rows[0].is_open, 0);

  const explicitOpen = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-a' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: 'APP_USR-token-loja-a',
      open_time: '08:00',
      close_time: '22:00',
      is_open: true,
      delivery_enabled: true,
      pickup_enabled: true,
      dine_in_enabled: true
    }
  });
  assert.strictEqual(explicitOpen.statusCode, 200);
  const lojaAAfterExplicitOpen = await db.query('SELECT is_open, last_pdv_heartbeat_at FROM store_settings WHERE loja_id = $1', ['loja-a']);
  assert.strictEqual(lojaAAfterExplicitOpen.rows[0].is_open, 1);
  assert.ok(lojaAAfterExplicitOpen.rows[0].last_pdv_heartbeat_at);

  const ownerGetA = await invoke(storeSettingsController.getSettings, {
    loja: { id: 'loja-a' }
  });

  assert.strictEqual(ownerGetA.statusCode, 200);
  assert.strictEqual(ownerGetA.body.mercado_pago_access_token, 'APP_USR-token-loja-a');
  assert.strictEqual(ownerGetA.body.pix_key, null);
  assert.strictEqual(ownerGetA.body.delivery_enabled, 1);
  assert.strictEqual(ownerGetA.body.pickup_enabled, 1);
  assert.strictEqual(ownerGetA.body.dine_in_enabled, 1);

  const ownerPutBFailed = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-b' },
    userLoja: { role: 'owner' },
    body: {
      mercado_pago_access_token: 'APP_USR-token-loja-b',
      is_open: false,
      delivery_enabled: false,
      pickup_enabled: false,
      dine_in_enabled: false
    }
  });
  assert.strictEqual(ownerPutBFailed.statusCode, 400);
  assert.strictEqual(ownerPutBFailed.body.code, 'STORE_SERVICE_MODES_VALIDATION_FAILED');

  const deliveryWithoutFee = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-b' },
    userLoja: { role: 'owner' },
    body: { is_open: false, delivery_enabled: true }
  });
  assert.strictEqual(deliveryWithoutFee.statusCode, 400);

  const pickupWithoutAddress = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-b' },
    userLoja: { role: 'owner' },
    body: { is_open: false, delivery_enabled: false, pickup_enabled: true, dine_in_enabled: false }
  });
  assert.strictEqual(pickupWithoutAddress.statusCode, 400);

  const dineInWithoutAddress = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-b' },
    userLoja: { role: 'owner' },
    body: { is_open: false, delivery_enabled: false, pickup_enabled: false, dine_in_enabled: true }
  });
  assert.strictEqual(dineInWithoutAddress.statusCode, 400);
  await db.query('UPDATE lojas SET cep = $1, rua = $2, numero = $3, bairro = $4, estado = $5, pais = $6 WHERE id = $7', ['02000-000', 'Rua B', '20', 'Centro', 'SP', 'Brasil', 'loja-b']);

  const ownerPutB = await invoke(storeSettingsController.upsertSettings, {
    loja: { id: 'loja-b' },
    userLoja: { role: 'owner' },
    body: { is_open: false, delivery_enabled: false, pickup_enabled: true, dine_in_enabled: false }
  });
  assert.strictEqual(ownerPutB.statusCode, 200);

  const ownerGetB = await invoke(storeSettingsController.getSettings, {
    loja: { id: 'loja-b' }
  });

  assert.strictEqual(ownerGetB.body.mercado_pago_access_token, null);
  assert.strictEqual(ownerGetB.body.delivery_enabled, 0);
  assert.strictEqual(ownerGetB.body.pickup_enabled, 1);
  assert.strictEqual(ownerGetB.body.dine_in_enabled, 0);
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
