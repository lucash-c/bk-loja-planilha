const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `public-pix-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const publicPixController = require('../src/controllers/publicPixController');
const { PIX_NOT_CONFIGURED_MESSAGE } = require('../src/services/publicPixService');

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
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, cidade TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE store_settings (loja_id TEXT UNIQUE, pix_key TEXT)');
}

async function run() {
  await setupSchema();

  await db.query('INSERT INTO lojas (id, public_key, name, cidade, is_active) VALUES ($1,$2,$3,$4,$5)', [
    'loja-1',
    'public-1',
    'Loja Teste',
    'São Paulo',
    1
  ]);

  await db.query('INSERT INTO lojas (id, public_key, name, cidade, is_active) VALUES ($1,$2,$3,$4,$5)', [
    'loja-2',
    'public-inativa',
    'Loja Inativa',
    'Campinas',
    0
  ]);

  await db.query('INSERT INTO lojas (id, public_key, name, cidade, is_active) VALUES ($1,$2,$3,$4,$5)', [
    'loja-3',
    'public-no-pix',
    'Loja Sem Pix',
    'Guarulhos',
    1
  ]);

  await db.query('INSERT INTO store_settings (loja_id, pix_key) VALUES ($1,$2)', [
    'loja-1',
    '11999999999'
  ]);

  const success = await invoke(publicPixController.generateCheckoutPix, {
    params: { public_key: 'public-1' },
    body: { amount: 59.9, description: 'Pedido da loja' }
  });

  assert.strictEqual(success.statusCode, 200);
  assert.strictEqual(success.body.ok, true);
  assert.strictEqual(success.body.pix.amount, 59.9);
  assert.strictEqual(success.body.pix.description, 'Pedido da loja');
  assert.ok(success.body.pix.qr_code_text.includes('br.gov.bcb.pix'));
  assert.ok(/6304[0-9A-F]{4}$/.test(success.body.pix.qr_code_text));
  assert.ok(typeof success.body.pix.qr_code_base64 === 'string');
  assert.ok(success.body.pix.qr_code_base64.length > 0);
  assert.ok(!('qr_code_image_url' in success.body.pix));
  assert.ok(typeof success.body.pix.txid === 'string');
  assert.ok(/^[A-Z0-9]{1,25}$/.test(success.body.pix.txid));

  const success2 = await invoke(publicPixController.generateCheckoutPix, {
    params: { public_key: 'public-1' },
    body: { amount: 59.9, description: 'Pedido da loja' }
  });
  assert.notStrictEqual(success2.body.pix.txid, success.body.pix.txid);

  const invalidAmount = await invoke(publicPixController.generateCheckoutPix, {
    params: { public_key: 'public-1' },
    body: { amount: 0 }
  });
  assert.strictEqual(invalidAmount.statusCode, 400);
  assert.strictEqual(invalidAmount.body.error, 'Informe um valor válido maior que zero.');

  const noPix = await invoke(publicPixController.generateCheckoutPix, {
    params: { public_key: 'public-no-pix' },
    body: { amount: 10 }
  });
  assert.strictEqual(noPix.statusCode, 400);
  assert.strictEqual(noPix.body.error, PIX_NOT_CONFIGURED_MESSAGE);

  const inactive = await invoke(publicPixController.generateCheckoutPix, {
    params: { public_key: 'public-inativa' },
    body: { amount: 10 }
  });
  assert.strictEqual(inactive.statusCode, 403);
  assert.strictEqual(inactive.body.error, 'Loja inativa.');

  const notFound = await invoke(publicPixController.generateCheckoutPix, {
    params: { public_key: 'nao-existe' },
    body: { amount: 10 }
  });
  assert.strictEqual(notFound.statusCode, 404);
  assert.strictEqual(notFound.body.error, 'Loja não encontrada.');

  console.log('Public PIX integration tests passed');
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
