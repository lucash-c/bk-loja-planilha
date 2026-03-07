const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `public-menu-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const publicMenuController = require('../src/controllers/publicMenuController');

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
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, whatsapp TEXT, logo TEXT, facebook TEXT, instagram TEXT, tiktok TEXT, cep TEXT, rua TEXT, numero TEXT, bairro TEXT, estado TEXT, pais TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE store_settings (loja_id TEXT UNIQUE, is_open INTEGER)');
  await db.query('CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, slug TEXT, image_url TEXT)');
  await db.query('CREATE TABLE products (id TEXT PRIMARY KEY, loja_id TEXT, category_id TEXT, name TEXT, is_active INTEGER, is_visible INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE product_options (id TEXT PRIMARY KEY, product_id TEXT, name TEXT, type TEXT, required INTEGER, min_choices INTEGER, max_choices INTEGER, is_visible INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE product_option_items (id TEXT PRIMARY KEY, option_id TEXT, name TEXT, price NUMERIC, is_active INTEGER, is_visible INTEGER)');
  await db.query('CREATE TABLE option_groups (id TEXT PRIMARY KEY, loja_id TEXT, name TEXT, type TEXT, required INTEGER, min_choices INTEGER, max_choices INTEGER, is_active INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE product_option_groups (product_id TEXT, option_group_id TEXT, created_at TEXT)');
  await db.query('CREATE TABLE option_group_items (id TEXT PRIMARY KEY, option_group_id TEXT, name TEXT, price NUMERIC, is_active INTEGER, is_visible INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE store_delivery_fees (loja_id TEXT, distance_km NUMERIC, fee NUMERIC, estimated_time_minutes INTEGER)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER, sort_order INTEGER, requires_change INTEGER)');
}

async function seedBase() {
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'public-loja', 'Loja Pública', 1]);
  await db.query('INSERT INTO store_settings (loja_id, is_open) VALUES ($1,$2)', ['loja-1', 0]);
  await db.query('INSERT INTO products (id, loja_id, category_id, name, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['p-legacy', 'loja-1', null, 'Produto Legado', 1, 1, '2024-01-01T10:00:00Z']);
  await db.query('INSERT INTO products (id, loja_id, category_id, name, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['p-group', 'loja-1', null, 'Produto Grupo', 1, 1, '2024-01-01T11:00:00Z']);
  await db.query('INSERT INTO products (id, loja_id, category_id, name, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['p-hybrid', 'loja-1', null, 'Produto Híbrido', 1, 1, '2024-01-01T12:00:00Z']);
}

async function seedLegacyOnly() {
  await db.query('INSERT INTO product_options (id, product_id, name, type, required, min_choices, max_choices, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['opt-l-1', 'p-legacy', 'Molhos', 'multiple', 0, 0, 2, 1, '2024-01-01T10:05:00Z']);
  await db.query('INSERT INTO product_option_items (id, option_id, name, price, is_active, is_visible) VALUES ($1,$2,$3,$4,$5,$6)', ['item-l-1', 'opt-l-1', 'Barbecue', 1.5, 1, 1]);
  await db.query('INSERT INTO product_option_items (id, option_id, name, price, is_active, is_visible) VALUES ($1,$2,$3,$4,$5,$6)', ['item-l-2', 'opt-l-1', 'Chipotle', 1.2, 1, 1]);
}

async function seedGroupOnly() {
  await db.query('INSERT INTO option_groups (id, loja_id, name, type, required, min_choices, max_choices, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['og-1', 'loja-1', 'Tamanho', 'single', 1, 1, 1, 1, '2024-01-01T11:01:00Z']);
  await db.query('INSERT INTO product_option_groups (product_id, option_group_id, created_at) VALUES ($1,$2,$3)', ['p-group', 'og-1', '2024-01-01T11:02:00Z']);
  await db.query('INSERT INTO option_group_items (id, option_group_id, name, price, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['ogi-1', 'og-1', 'Grande', 5, 1, 1, '2024-01-01T11:03:00Z']);
  await db.query('INSERT INTO option_group_items (id, option_group_id, name, price, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['ogi-2', 'og-1', 'Médio', 3, 1, 1, '2024-01-01T11:04:00Z']);
}

async function seedHybrid() {
  await db.query('INSERT INTO product_options (id, product_id, name, type, required, min_choices, max_choices, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['opt-h-legacy', 'p-hybrid', 'Adicionais', 'multiple', 0, 0, 2, 1, '2024-01-01T12:05:00Z']);
  await db.query('INSERT INTO product_option_items (id, option_id, name, price, is_active, is_visible) VALUES ($1,$2,$3,$4,$5,$6)', ['item-h-l-1', 'opt-h-legacy', 'Bacon', 2, 1, 1]);

  await db.query('INSERT INTO product_options (id, product_id, name, type, required, min_choices, max_choices, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['opt-h-dup-legacy', 'p-hybrid', 'Molhos', 'multiple', 0, 0, 2, 1, '2024-01-01T12:06:00Z']);
  await db.query('INSERT INTO product_option_items (id, option_id, name, price, is_active, is_visible) VALUES ($1,$2,$3,$4,$5,$6)', ['item-h-l-2', 'opt-h-dup-legacy', 'Ketchup', 0, 1, 1]);

  await db.query('INSERT INTO option_groups (id, loja_id, name, type, required, min_choices, max_choices, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['og-h-dup', 'loja-1', 'Molhos', 'multiple', 0, 0, 3, 1, '2024-01-01T12:07:00Z']);
  await db.query('INSERT INTO product_option_groups (product_id, option_group_id, created_at) VALUES ($1,$2,$3)', ['p-hybrid', 'og-h-dup', '2024-01-01T12:08:00Z']);
  await db.query('INSERT INTO option_group_items (id, option_group_id, name, price, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['ogi-h-1', 'og-h-dup', 'Maionese', 0.5, 1, 1, '2024-01-01T12:09:00Z']);

  await db.query('INSERT INTO option_groups (id, loja_id, name, type, required, min_choices, max_choices, is_active, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', ['og-h-hidden', 'loja-1', 'Secretos', 'multiple', 0, 0, 2, 1, '2024-01-01T12:10:00Z']);
  await db.query('INSERT INTO product_option_groups (product_id, option_group_id, created_at) VALUES ($1,$2,$3)', ['p-hybrid', 'og-h-hidden', '2024-01-01T12:11:00Z']);
  await db.query('INSERT INTO option_group_items (id, option_group_id, name, price, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['ogi-h-hidden-1', 'og-h-hidden', 'Invisível', 1, 1, 0, '2024-01-01T12:12:00Z']);
  await db.query('INSERT INTO option_group_items (id, option_group_id, name, price, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['ogi-h-hidden-2', 'og-h-hidden', 'Inativo', 1, 0, 1, '2024-01-01T12:13:00Z']);
}

async function run() {
  await setupSchema();
  await seedBase();
  await seedLegacyOnly();
  await seedGroupOnly();
  await seedHybrid();

  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, label, is_active, sort_order, requires_change) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['pm-1', 'loja-1', 'pix', 'PIX', 1, 1, 0]);
  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, label, is_active, sort_order, requires_change) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['pm-2', 'loja-1', 'dinheiro', 'Dinheiro', 1, 2, 1]);
  await db.query('INSERT INTO store_payment_methods (id, loja_id, code, label, is_active, sort_order, requires_change) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['pm-3', 'loja-1', 'credito', 'Cartão de Crédito', 0, 3, 0]);

  process.env.PUBLIC_MENU_OPTIONS_SOURCE = 'hybrid';
  delete process.env.PUBLIC_MENU_OPTIONS_INCLUDE_SOURCE;

  const response = await invoke(publicMenuController.getPublicMenu, {
    params: { public_key: 'public-loja' },
    query: {}
  });

  assert.strictEqual(response.statusCode, 200);
  assert.ok(Array.isArray(response.body.products));
  assert.strictEqual(response.body.loja.is_open, 0);

  assert.ok(Array.isArray(response.body.payment_methods));
  assert.deepStrictEqual(response.body.payment_methods, [
    { code: 'pix', label: 'PIX', requires_change: 0, sort_order: 1 },
    { code: 'dinheiro', label: 'Dinheiro', requires_change: 1, sort_order: 2 }
  ]);

  const legacyProduct = response.body.products.find(product => product.id === 'p-legacy');
  assert.strictEqual(legacyProduct.options.length, 1);
  assert.strictEqual(legacyProduct.options[0].name, 'Molhos');
  assert.deepStrictEqual(legacyProduct.options[0].items.map(item => item.name), ['Barbecue', 'Chipotle']);

  const groupProduct = response.body.products.find(product => product.id === 'p-group');
  assert.strictEqual(groupProduct.options.length, 1);
  assert.strictEqual(groupProduct.options[0].name, 'Tamanho');
  assert.deepStrictEqual(groupProduct.options[0].items.map(item => item.name), ['Grande', 'Médio']);

  const hybridProduct = response.body.products.find(product => product.id === 'p-hybrid');
  assert.strictEqual(hybridProduct.options.length, 3);
  assert.ok(hybridProduct.options.every(option => !Object.prototype.hasOwnProperty.call(option, 'source')));

  const hybridOptionNames = hybridProduct.options.map(option => option.name);
  assert.deepStrictEqual(hybridOptionNames, ['Adicionais', 'Molhos', 'Secretos']);

  const molhosOption = hybridProduct.options.find(option => option.name === 'Molhos');
  assert.deepStrictEqual(molhosOption.items.map(item => item.name), ['Maionese']);

  const secretosOption = hybridProduct.options.find(option => option.name === 'Secretos');
  assert.strictEqual(secretosOption.items.length, 0);

  const canonicalShapeOption = legacyProduct.options[0];
  assert.deepStrictEqual(Object.keys(canonicalShapeOption).sort(), ['created_at', 'id', 'items', 'max_choices', 'min_choices', 'name', 'required', 'type']);
  assert.deepStrictEqual(Object.keys(canonicalShapeOption.items[0]).sort(), ['id', 'name', 'price']);

  process.env.PUBLIC_MENU_OPTIONS_SOURCE = 'legacy';
  const legacyOnlyResponse = await invoke(publicMenuController.getPublicMenu, {
    params: { public_key: 'public-loja' },
    query: {}
  });
  const legacyOnlyHybridProduct = legacyOnlyResponse.body.products.find(product => product.id === 'p-hybrid');
  assert.deepStrictEqual(legacyOnlyHybridProduct.options.map(option => option.name), ['Adicionais', 'Molhos']);

  process.env.PUBLIC_MENU_OPTIONS_SOURCE = 'group';
  const groupOnlyResponse = await invoke(publicMenuController.getPublicMenu, {
    params: { public_key: 'public-loja' },
    query: {}
  });
  const groupOnlyHybridProduct = groupOnlyResponse.body.products.find(product => product.id === 'p-hybrid');
  assert.deepStrictEqual(groupOnlyHybridProduct.options.map(option => option.name), ['Molhos', 'Secretos']);

  console.log('Public menu integration tests passed');
}

run()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    delete process.env.PUBLIC_MENU_OPTIONS_SOURCE;
    delete process.env.PUBLIC_MENU_OPTIONS_INCLUDE_SOURCE;
    try {
      fs.unlinkSync(tempDbPath);
    } catch (_) {}
  });
