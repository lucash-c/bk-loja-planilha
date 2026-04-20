const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `activation-hardening-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const categoriesController = require('../src/controllers/categoriesController');
const productsController = require('../src/controllers/productsController');
const publicMenuController = require('../src/controllers/publicMenuController');

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
      return this;
    },
    end() {
      return this;
    },
    send(payload) {
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
  await db.query('CREATE TABLE categories (id TEXT PRIMARY KEY, loja_id TEXT, name TEXT, slug TEXT, image_url TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE products (id TEXT PRIMARY KEY, loja_id TEXT, category_id TEXT, name TEXT, is_active INTEGER, is_visible INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE store_settings (loja_id TEXT UNIQUE, is_open INTEGER)');
  await db.query('CREATE TABLE product_options (id TEXT PRIMARY KEY, product_id TEXT, name TEXT, type TEXT, required INTEGER, min_choices INTEGER, max_choices INTEGER, is_visible INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE product_option_items (id TEXT PRIMARY KEY, option_id TEXT, name TEXT, price NUMERIC, is_active INTEGER, is_visible INTEGER)');
  await db.query('CREATE TABLE option_groups (id TEXT PRIMARY KEY, loja_id TEXT, name TEXT, type TEXT, required INTEGER, min_choices INTEGER, max_choices INTEGER, is_active INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE product_option_groups (product_id TEXT, option_group_id TEXT, created_at TEXT)');
  await db.query('CREATE TABLE option_group_items (id TEXT PRIMARY KEY, option_group_id TEXT, name TEXT, price NUMERIC, is_active INTEGER, is_visible INTEGER, created_at TEXT)');
  await db.query('CREATE TABLE store_delivery_fees (loja_id TEXT, distance_km NUMERIC, fee NUMERIC, estimated_time_minutes INTEGER)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER, sort_order INTEGER, requires_change INTEGER)');
}

async function seedData() {
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'pub-1', 'Loja 1', 1]);
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-2', 'pub-2', 'Loja 2', 1]);
  await db.query('INSERT INTO store_settings (loja_id, is_open) VALUES ($1,$2)', ['loja-1', 1]);

  await db.query('INSERT INTO categories (id, loja_id, name, slug, image_url, is_active) VALUES ($1,$2,$3,$4,$5,$6)', ['cat-1', 'loja-1', 'Categoria 1', 'categoria-1', null, 1]);
  await db.query('INSERT INTO categories (id, loja_id, name, slug, image_url, is_active) VALUES ($1,$2,$3,$4,$5,$6)', ['cat-2', 'loja-2', 'Categoria 2', 'categoria-2', null, 1]);

  await db.query('INSERT INTO products (id, loja_id, category_id, name, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['prod-1', 'loja-1', 'cat-1', 'Produto 1', 1, 1, '2024-01-01T00:00:00Z']);
  await db.query('INSERT INTO products (id, loja_id, category_id, name, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['prod-2', 'loja-1', 'cat-1', 'Produto 2', 1, 1, '2024-01-01T00:01:00Z']);
  await db.query('INSERT INTO products (id, loja_id, category_id, name, is_active, is_visible, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', ['prod-other-store', 'loja-2', 'cat-2', 'Produto Outra Loja', 1, 1, '2024-01-01T00:02:00Z']);
}

async function run() {
  await setupSchema();
  await seedData();

  const deactivatedProduct = await invoke(productsController.deactivateProduct, {
    loja: { id: 'loja-1' },
    params: { id: 'prod-1' }
  });
  assert.strictEqual(deactivatedProduct.statusCode, 200);
  assert.strictEqual(deactivatedProduct.body.is_active, 0);

  const adminList = await invoke(productsController.listProducts, {
    loja: { id: 'loja-1' },
    query: {},
    headers: {}
  });
  assert.strictEqual(adminList.statusCode, 200);
  assert.ok(adminList.body.find(product => product.id === 'prod-1'));

  const publicMenuAfterProductDeactivate = await invoke(publicMenuController.getPublicMenu, {
    params: { public_key: 'pub-1' },
    query: {},
    headers: {}
  });
  assert.strictEqual(publicMenuAfterProductDeactivate.statusCode, 200);
  assert.ok(!publicMenuAfterProductDeactivate.body.products.find(product => product.id === 'prod-1'));

  const deactivateCategoryRes = await invoke(categoriesController.deactivateCategory, {
    loja: { id: 'loja-1' },
    params: { id: 'cat-1' },
    query: {},
    headers: {}
  });
  assert.strictEqual(deactivateCategoryRes.statusCode, 200);
  assert.strictEqual(deactivateCategoryRes.body.is_active, 0);

  const categoryProductsState = await db.query('SELECT id, is_active FROM products WHERE loja_id = $1 AND category_id = $2 ORDER BY id ASC', ['loja-1', 'cat-1']);
  assert.deepStrictEqual(categoryProductsState.rows, [
    { id: 'prod-1', is_active: 0 },
    { id: 'prod-2', is_active: 0 }
  ]);

  const otherStoreProductState = await db.query('SELECT is_active FROM products WHERE id = $1', ['prod-other-store']);
  assert.strictEqual(otherStoreProductState.rows[0].is_active, 1);

  const publicMenuAfterCategoryDeactivate = await invoke(publicMenuController.getPublicMenu, {
    params: { public_key: 'pub-1' },
    query: {},
    headers: {}
  });
  assert.ok(!publicMenuAfterCategoryDeactivate.body.categories.find(category => category.id === 'cat-1'));
  assert.ok(!publicMenuAfterCategoryDeactivate.body.products.find(product => product.category_id === 'cat-1'));

  const activateCategoryRes = await invoke(categoriesController.activateCategory, {
    loja: { id: 'loja-1' },
    params: { id: 'cat-1' },
    query: {},
    headers: {}
  });
  assert.strictEqual(activateCategoryRes.statusCode, 200);
  assert.strictEqual(activateCategoryRes.body.is_active, 1);

  const productsRemainInactive = await db.query('SELECT COUNT(*) AS total FROM products WHERE loja_id = $1 AND category_id = $2 AND is_active = 1', ['loja-1', 'cat-1']);
  assert.strictEqual(Number(productsRemainInactive.rows[0].total), 0);

  const blockHardDeleteRes = await invoke(categoriesController.hardDeleteCategory, {
    loja: { id: 'loja-1' },
    params: { id: 'cat-1' },
    query: {},
    headers: {}
  });
  assert.strictEqual(blockHardDeleteRes.statusCode, 409);

  const forceHardDeleteRes = await invoke(categoriesController.hardDeleteCategory, {
    loja: { id: 'loja-1' },
    params: { id: 'cat-1' },
    query: { force_cascade: 'true' },
    headers: {}
  });
  assert.strictEqual(forceHardDeleteRes.statusCode, 204);

  const removedCategory = await db.query('SELECT id FROM categories WHERE id = $1', ['cat-1']);
  assert.strictEqual(removedCategory.rows.length, 0);

  const removedProducts = await db.query('SELECT id FROM products WHERE category_id = $1 AND loja_id = $2', ['cat-1', 'loja-1']);
  assert.strictEqual(removedProducts.rows.length, 0);

  const hardDeleteProductRes = await invoke(productsController.hardDeleteProduct, {
    loja: { id: 'loja-2' },
    params: { id: 'prod-other-store' }
  });
  assert.strictEqual(hardDeleteProductRes.statusCode, 204);

  console.log('Activation hardening integration tests passed');
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
