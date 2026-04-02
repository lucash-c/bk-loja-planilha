const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `order-payload-contract-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT, loja_id TEXT, role TEXT, credits NUMERIC, updated_at TEXT)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, customer_whatsapp TEXT, order_type TEXT, delivery_address TEXT, delivery_distance_km NUMERIC, delivery_estimated_time_minutes INTEGER, delivery_fee NUMERIC, total NUMERIC, payment_method TEXT, origin TEXT, payment_status TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE order_jobs (id TEXT PRIMARY KEY, order_id TEXT, loja_id TEXT, job_type TEXT, payload TEXT, status TEXT, attempts INTEGER, max_attempts INTEGER, run_at TEXT, locked_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT)');
}

async function seedStore() {
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', ['loja-1', 'loja-key', 'Loja Teste', 1]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ul-1', 'owner-1', 'loja-1', 'owner', 100]);
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

async function createOrder(body) {
  return invoke(ordersController.createOrder, {
    loja: { id: 'loja-1' },
    body
  });
}

function assertCanonicalOption(option) {
  const allowedKeys = ['option_id', 'option_name', 'item_id', 'item_name', 'price'];
  const keys = Object.keys(option);
  keys.forEach(key => assert.ok(allowedKeys.includes(key), `chave não canônica em option: ${key}`));
  if (typeof option.price !== 'undefined') {
    assert.strictEqual(typeof option.price, 'number', 'price deve ser number no shape canônico');
  }
}

function assertCanonicalItemReadShape(item) {
  assert.ok(Array.isArray(item.options), 'item.options precisa ser array no read canônico');

  if (item.options.length === 0) {
    assert.strictEqual(item.options_json, null, 'sem opções válidas, options_json deve ser null');
    assert.strictEqual(item.optionsJson, null, 'sem opções válidas, optionsJson deve ser null');
  } else {
    assert.deepStrictEqual(item.options_json, item.options, 'options_json deve espelhar options');
    assert.deepStrictEqual(item.optionsJson, item.options, 'optionsJson deve espelhar options');
    item.options.forEach(assertCanonicalOption);
  }
}

async function run() {
  await setupSchema();
  await seedStore();

  // 1) shape canônico de escrita (order + item + options flat)
  const canonicalCreate = await createOrder({
    external_id: 'contract-canonical',
    customer_name: 'Cliente 1',
    order_type: 'entrega',
    origin: 'cliente',
    total: 42,
    items: [
      {
        product_name: 'Pizza',
        quantity: 2,
        unit_price: 21,
        observation: 'sem cebola',
        options: [
          {
            option_id: 'grp-1',
            option_name: 'Sabores',
            item_id: 'itm-1',
            item_name: 'Calabresa',
            price: '1.239'
          }
        ]
      }
    ]
  });

  assert.strictEqual(canonicalCreate.statusCode, 201);
  const canonicalOrderId = canonicalCreate.body.order.id;

  const canonicalStoredItems = await db.query('SELECT observation, options_json FROM order_items WHERE order_id = $1', [canonicalOrderId]);
  assert.strictEqual(canonicalStoredItems.rows[0].observation, 'sem cebola');
  assert.deepStrictEqual(JSON.parse(canonicalStoredItems.rows[0].options_json), [
    {
      option_id: 'grp-1',
      option_name: 'Sabores',
      item_id: 'itm-1',
      item_name: 'Calabresa',
      price: 1.24
    }
  ]);

  // 2) fallback legacy: observation aliases + options_json/optionsJson + grouped/container
  const legacyCreate = await createOrder({
    external_id: 'contract-legacy',
    total: 30,
    items: [
      {
        product_name: 'Lanche',
        quantity: 1,
        unit_price: 30,
        observacao: 'sem picles',
        options_json: JSON.stringify([
          { option_name: 'Molho', item_name: 'Barbecue', price: '2.001' }
        ])
      },
      {
        product_name: 'Pizza Grande',
        quantity: 1,
        unit_price: 30,
        optionsJson: {
          groups: [
            {
              group_name: 'Adicionais',
              selected_items: [
                { item_name: 'Bacon', value: '5.127' }
              ]
            }
          ]
        }
      }
    ]
  });

  assert.strictEqual(legacyCreate.statusCode, 201);

  const legacyItemsStored = await db.query(
    'SELECT product_name, observation, options_json FROM order_items WHERE order_id = $1 ORDER BY product_name ASC',
    [legacyCreate.body.order.id]
  );

  assert.strictEqual(legacyItemsStored.rows[0].observation, 'sem picles');
  assert.deepStrictEqual(JSON.parse(legacyItemsStored.rows[0].options_json), [
    { option_name: 'Molho', item_name: 'Barbecue', price: 2 }
  ]);

  assert.strictEqual(legacyItemsStored.rows[1].observation, null);
  assert.deepStrictEqual(JSON.parse(legacyItemsStored.rows[1].options_json), [
    { option_name: 'Adicionais', item_name: 'Bacon', price: 5.13 }
  ]);

  // 3) precedência: options válido vence options_json/optionsJson
  const precedenceCreate = await createOrder({
    external_id: 'contract-precedence',
    total: 10,
    items: [
      {
        product_name: 'Combo',
        quantity: 1,
        unit_price: 10,
        options: [{ option_name: 'Canônico', item_name: 'Valor usado', price: 3 }],
        options_json: JSON.stringify([{ option_name: 'Legacy snake', item_name: 'não usar', price: 1 }]),
        optionsJson: [{ option_name: 'Legacy camel', item_name: 'não usar', price: 2 }]
      }
    ]
  });

  assert.strictEqual(precedenceCreate.statusCode, 201);
  const precedenceRow = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [precedenceCreate.body.order.id]);
  assert.deepStrictEqual(JSON.parse(precedenceRow.rows[0].options_json), [
    { option_name: 'Canônico', item_name: 'Valor usado', price: 3 }
  ]);

  // 4) shape canônico de leitura (GET por id + list include=items)
  const getById = await invoke(ordersController.getOrder, {
    loja: { id: 'loja-1' },
    params: { id: legacyCreate.body.order.id }
  });
  assert.strictEqual(getById.statusCode, 200);
  getById.body.items.forEach(assertCanonicalItemReadShape);

  const listWithItems = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: { include: 'items', q: 'contract-' }
  });
  assert.strictEqual(listWithItems.statusCode, 200);

  const listedLegacy = listWithItems.body.find(order => order.external_id === 'contract-legacy');
  assert.ok(listedLegacy, 'pedido legacy deve existir em listOrders');
  listedLegacy.items.forEach(assertCanonicalItemReadShape);

  const listedCanonical = listWithItems.body.find(order => order.external_id === 'contract-canonical');
  assert.ok(listedCanonical, 'pedido canônico deve existir em listOrders');
  listedCanonical.items.forEach(assertCanonicalItemReadShape);

  // 5) createPdvTransactional mantém o mesmo contrato de items/options no write e no read
  const pdvCreate = await invoke(ordersController.createPdvTransactional, {
    headers: { 'x-loja-key': 'loja-key' },
    body: {
      external_id: 'contract-pdv',
      order_type: 'retirada',
      total: 80,
      items: [
        {
          product_name: 'Pizza Família',
          quantity: 1,
          unit_price: 70,
          obs: 'assar bem',
          optionsJson: {
            groups: [
              {
                name: 'Sabores',
                items: [
                  { name: 'Calabresa', price: '5.004' },
                  { name: 'Mussarela', price: '5.004' }
                ]
              }
            ]
          }
        }
      ]
    }
  });

  assert.strictEqual(pdvCreate.statusCode, 201);
  assert.strictEqual(pdvCreate.body.order.origin, 'pdv');
  assert.strictEqual(pdvCreate.body.order.status, 'em preparo');

  const pdvStoredItems = await db.query(
    'SELECT observation, options_json FROM order_items WHERE order_id = $1',
    [pdvCreate.body.order.id]
  );
  assert.strictEqual(pdvStoredItems.rows[0].observation, 'assar bem');
  assert.deepStrictEqual(JSON.parse(pdvStoredItems.rows[0].options_json), [
    { option_name: 'Sabores', item_name: 'Calabresa', price: 5 },
    { option_name: 'Sabores', item_name: 'Mussarela', price: 5 }
  ]);

  const pdvGetById = await invoke(ordersController.getOrder, {
    loja: { id: 'loja-1' },
    params: { id: pdvCreate.body.order.id }
  });
  assert.strictEqual(pdvGetById.statusCode, 200);
  pdvGetById.body.items.forEach(assertCanonicalItemReadShape);

  console.log('✅ order payload contract integration test passed');
}

run()
  .catch(err => {
    console.error('❌ order payload contract integration test failed');
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  });
