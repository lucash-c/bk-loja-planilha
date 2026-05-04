const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jwt = require('jsonwebtoken');

const tempDbPath = path.join(os.tmpdir(), `register-with-store-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const db = require('../src/config/db');
const authController = require('../src/controllers/authController');

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
  await db.query('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, password_hash TEXT NOT NULL, role TEXT NOT NULL)');
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, whatsapp TEXT NOT NULL, telefone TEXT, responsavel_nome TEXT, email TEXT, cpf_cnpj TEXT, pais TEXT, estado TEXT, cidade TEXT, bairro TEXT, rua TEXT, numero TEXT, cep TEXT, facebook TEXT, instagram TEXT, tiktok TEXT, logo TEXT, is_active INTEGER DEFAULT 1)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, loja_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT \'owner\', credits REAL DEFAULT 0)');
}

async function run() {
  await setupSchema();

  const req = {
    body: {
      email: 'owner@acme.com',
      password: 'segredo123',
      name: 'Owner Acme',
      role: 'owner',
      loja: {
        name: 'Acme Centro',
        whatsapp: '5511999999999',
        telefone: '1133334444',
        responsavel_nome: 'Owner Acme',
        email: 'contato@acme.com',
        cpf_cnpj: '12345678000199',
        pais: 'Brasil',
        estado: 'SP',
        cidade: 'São Paulo',
        bairro: 'Centro',
        rua: 'Rua 1',
        numero: '100',
        cep: '01001000',
        logo: 'https://cdn.exemplo.com/acme.png'
      }
    }
  };

  const response = await invoke(authController.registerWithStore, req);

  assert.strictEqual(response.statusCode, 201);
  assert.strictEqual(response.body.ok, true);
  assert.ok(response.body.user.id);
  assert.ok(response.body.loja.id);
  assert.ok(response.body.loja.public_key);
  assert.strictEqual(response.body.loja.public_key, 'acmecentro');

  const tokenPayload = jwt.verify(response.body.token, process.env.JWT_SECRET);
  assert.strictEqual(tokenPayload.sub, response.body.user.id);
  assert.strictEqual(tokenPayload.loja_id, response.body.loja.id);
  assert.strictEqual(tokenPayload.loja_role, 'owner');

  const usersRes = await db.query('SELECT * FROM users WHERE email = $1', ['owner@acme.com']);
  assert.strictEqual(usersRes.rows.length, 1);

  const lojasRes = await db.query('SELECT * FROM lojas WHERE id = $1', [response.body.loja.id]);
  assert.strictEqual(lojasRes.rows.length, 1);
  assert.strictEqual(lojasRes.rows[0].public_key, 'acmecentro');

  const userLojasRes = await db.query('SELECT * FROM user_lojas WHERE user_id = $1 AND loja_id = $2', [response.body.user.id, response.body.loja.id]);
  assert.strictEqual(userLojasRes.rows.length, 1);

  console.log('Register with store integration test passed');
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
