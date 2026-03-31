const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tempDbPath = path.join(os.tmpdir(), `orders-options-${Date.now()}.db`);
process.env.SQLITE_PATH = tempDbPath;
delete process.env.DATABASE_URL;

const db = require('../src/config/db');
const ordersController = require('../src/controllers/ordersController');

const FLAT_OPTION_KEYS = ['option_id', 'option_name', 'item_id', 'item_name', 'price'];

async function setupSchema() {
  await db.query('CREATE TABLE lojas (id TEXT PRIMARY KEY, public_key TEXT UNIQUE, name TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE user_lojas (id TEXT PRIMARY KEY, user_id TEXT, loja_id TEXT, role TEXT, credits NUMERIC, updated_at TEXT)');
  await db.query('CREATE TABLE store_payment_methods (id TEXT PRIMARY KEY, loja_id TEXT, code TEXT, label TEXT, is_active INTEGER)');
  await db.query('CREATE TABLE orders (id TEXT PRIMARY KEY, loja_id TEXT, external_id TEXT, customer_name TEXT, customer_whatsapp TEXT, order_type TEXT, delivery_address TEXT, delivery_distance_km NUMERIC, delivery_estimated_time_minutes INTEGER, delivery_fee NUMERIC, total NUMERIC, payment_method TEXT, origin TEXT, payment_status TEXT, status TEXT, notes TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE order_items (id TEXT PRIMARY KEY, order_id TEXT, product_name TEXT, quantity INTEGER, unit_price NUMERIC, total_price NUMERIC, observation TEXT, options_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  await db.query('CREATE TABLE order_jobs (id TEXT PRIMARY KEY, order_id TEXT, loja_id TEXT, job_type TEXT, payload TEXT, status TEXT, attempts INTEGER, max_attempts INTEGER, run_at TEXT, locked_at TEXT, completed_at TEXT, created_at TEXT, updated_at TEXT)');
}

async function seedStore({ lojaId = 'loja-1', key = 'loja-key' }) {
  await db.query('INSERT INTO lojas (id, public_key, name, is_active) VALUES ($1,$2,$3,$4)', [lojaId, key, 'Loja Teste', 1]);
  await db.query('INSERT INTO user_lojas (id, user_id, loja_id, role, credits) VALUES ($1,$2,$3,$4,$5)', ['ul-1', 'owner-1', lojaId, 'owner', 100]);
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

function assertFlatOptionShape(option) {
  assert.ok(option && typeof option === 'object' && !Array.isArray(option), 'option deve ser objeto plano');

  const keys = Object.keys(option).sort();
  const allowedSorted = [...FLAT_OPTION_KEYS].sort();
  assert.deepStrictEqual(keys, keys.filter(key => allowedSorted.includes(key)), 'option contém apenas chaves documentadas');

  for (const key of keys) {
    if (key === 'price') {
      assert.strictEqual(typeof option[key], 'number', 'price deve ser number');
      continue;
    }

    assert.strictEqual(typeof option[key], 'string', `${key} deve ser string`);
  }

  assert.ok(option.option_name || option.item_name, 'option precisa de option_name ou item_name');
}

async function createOrder({ externalId, items }) {
  return invoke(ordersController.createOrder, {
    loja: { id: 'loja-1' },
    body: {
      external_id: externalId,
      total: 30,
      items
    }
  });
}

async function createPdvTransactional({ externalId, items }) {
  return invoke(ordersController.createPdvTransactional, {
    headers: {
      'x-loja-key': 'loja-key',
      'idempotency-key': `idem-${externalId}`
    },
    body: {
      external_id: externalId,
      total: 30,
      items
    }
  });
}

async function run() {
  await setupSchema();
  await seedStore({});

  // criação com items[].options persiste em order_items.options_json
  const optionsOrder = await createOrder({
    externalId: 'opt-array',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 30,
        options: [
          {
            option_id: 123,
            option_name: '  Borda  ',
            item_id: 'itm-1',
            item_name: 'Catupiry',
            price: '4.555',
            ignored: { nested: true }
          }
        ]
      }
    ]
  });

  assert.strictEqual(optionsOrder.statusCode, 201);
  const optionsOrderId = optionsOrder.body.order.id;
  const itemPersistedWithOptions = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [optionsOrderId]);
  const persistedOptions = JSON.parse(itemPersistedWithOptions.rows[0].options_json);
  assert.deepStrictEqual(persistedOptions, [{ option_id: '123', option_name: 'Borda', item_id: 'itm-1', item_name: 'Catupiry', price: 4.55 }]);

  // criação com items[].options_json legado continua funcionando
  const legacyOrder = await createOrder({
    externalId: 'opt-legacy',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 25,
        options_json: JSON.stringify([
          {
            option_name: 'Molho',
            item_name: 'Barbecue',
            price: '2.4999',
            extra_field: 'remove-me'
          }
        ])
      }
    ]
  });

  assert.strictEqual(legacyOrder.statusCode, 201);
  const legacyOrderId = legacyOrder.body.order.id;
  const itemPersistedLegacy = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [legacyOrderId]);
  assert.deepStrictEqual(JSON.parse(itemPersistedLegacy.rows[0].options_json), [{ option_name: 'Molho', item_name: 'Barbecue', price: 2.5 }]);

  // criação com ambos: options prevalece quando válido
  const bothOrder = await createOrder({
    externalId: 'opt-both',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 28,
        options: [{ option_name: 'Tamanho', item_name: 'Grande', price: 3 }],
        options_json: JSON.stringify([{ option_name: 'Tamanho', item_name: 'Pequena', price: 1 }])
      }
    ]
  });

  assert.strictEqual(bothOrder.statusCode, 201);
  const bothOrderId = bothOrder.body.order.id;
  const itemPersistedBoth = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [bothOrderId]);
  assert.deepStrictEqual(JSON.parse(itemPersistedBoth.rows[0].options_json), [{ option_name: 'Tamanho', item_name: 'Grande', price: 3 }]);

  // payload malformado não polui DB nem resposta
  const malformedOrder = await createOrder({
    externalId: 'opt-malformed',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 20,
        options: 'dump-string-invalido',
        options_json: '{not-valid-json'
      },
      {
        product_name: 'Pizza 2',
        quantity: 1,
        unit_price: 10,
        options: { invalid: true },
        options_json: { invalid: true }
      }
    ]
  });

  assert.strictEqual(malformedOrder.statusCode, 201);
  const malformedOrderId = malformedOrder.body.order.id;
  const malformedRows = await db.query('SELECT options_json FROM order_items WHERE order_id = $1 ORDER BY product_name ASC', [malformedOrderId]);
  assert.strictEqual(malformedRows.rows[0].options_json, null);
  assert.strictEqual(malformedRows.rows[1].options_json, null);

  const malformedReadRes = await invoke(ordersController.getOrder, {
    loja: { id: 'loja-1' },
    params: { id: malformedOrderId }
  });
  assert.strictEqual(malformedReadRes.statusCode, 200);
  assert.deepStrictEqual(malformedReadRes.body.items[0].options, []);
  assert.strictEqual(malformedReadRes.body.items[0].options_json, null);
  assert.deepStrictEqual(malformedReadRes.body.items[1].options, []);
  assert.strictEqual(malformedReadRes.body.items[1].options_json, null);

  // createPdvTransactional também persiste options normalizado
  const pdvOrder = await createPdvTransactional({
    externalId: 'pdv-options',
    items: [
      {
        product_name: 'Combo',
        quantity: 1,
        unit_price: 30,
        options: [
          {
            option_name: 'Adicionais',
            item_name: 'Bacon',
            price: '5.127',
            metadata_dump: { internal: true }
          }
        ]
      }
    ]
  });

  assert.strictEqual(pdvOrder.statusCode, 201);
  const pdvOrderId = pdvOrder.body.order.id;
  const pdvItemPersisted = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [pdvOrderId]);
  assert.deepStrictEqual(JSON.parse(pdvItemPersisted.rows[0].options_json), [
    { option_name: 'Adicionais', item_name: 'Bacon', price: 5.13 }
  ]);

  // createOrder aceita shape agrupado (grupo + items)
  const groupedOrder = await createOrder({
    externalId: 'opt-grouped-items',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 40,
        options: [
          {
            name: 'Sabores',
            items: [
              { name: 'calabresa', price: 35 },
              { name: 'mussarela', price: 50 }
            ]
          },
          {
            name: 'Adicionais',
            items: [
              { name: 'aaaa', price: 10 }
            ]
          }
        ]
      }
    ]
  });
  assert.strictEqual(groupedOrder.statusCode, 201);
  const groupedOrderId = groupedOrder.body.order.id;
  const groupedPersisted = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [groupedOrderId]);
  assert.deepStrictEqual(JSON.parse(groupedPersisted.rows[0].options_json), [
    { option_name: 'Sabores', item_name: 'calabresa', price: 35 },
    { option_name: 'Sabores', item_name: 'mussarela', price: 50 },
    { option_name: 'Adicionais', item_name: 'aaaa', price: 10 }
  ]);

  // createOrder aceita shape selected_items
  const selectedItemsOrder = await createOrder({
    externalId: 'opt-selected-items',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 30,
        options: [
          {
            group_name: 'Sabores',
            selected_items: [
              { item_name: 'calabresa', price: 35 }
            ]
          }
        ]
      }
    ]
  });
  assert.strictEqual(selectedItemsOrder.statusCode, 201);
  const selectedItemsOrderId = selectedItemsOrder.body.order.id;
  const selectedPersisted = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [selectedItemsOrderId]);
  assert.deepStrictEqual(JSON.parse(selectedPersisted.rows[0].options_json), [
    { option_name: 'Sabores', item_name: 'calabresa', price: 35 }
  ]);

  // createOrder aceita container com options
  const containerOrder = await createOrder({
    externalId: 'opt-container',
    items: [
      {
        product_name: 'Pizza',
        quantity: 1,
        unit_price: 30,
        options: {
          options: [
            {
              option_name: 'Sabores',
              items: [
                { name: 'calabresa', price: 35 }
              ]
            }
          ]
        }
      }
    ]
  });
  assert.strictEqual(containerOrder.statusCode, 201);
  const containerOrderId = containerOrder.body.order.id;
  const containerPersisted = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [containerOrderId]);
  assert.deepStrictEqual(JSON.parse(containerPersisted.rows[0].options_json), [
    { option_name: 'Sabores', item_name: 'calabresa', price: 35 }
  ]);

  // registro antigo com options_json string/JSON parcial continua legível
  const legacyManualOrderId = 'legacy-manual-order';
  await db.query(
    `INSERT INTO orders (id, loja_id, external_id, order_type, total, origin, payment_status, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [legacyManualOrderId, 'loja-1', 'legacy-manual', 'entrega', 15, 'cliente', 'pending', 'new']
  );
  await db.query(
    `INSERT INTO order_items (id, order_id, product_name, quantity, unit_price, total_price, observation, options_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      'legacy-item-1',
      legacyManualOrderId,
      'Pastel',
      1,
      15,
      15,
      null,
      JSON.stringify([
        { option_name: 'Complementos', item_name: 'Queijo extra', junk: { deep: true } },
        { option_id: 'x' },
        'broken',
        { item_name: 'Molho verde', price: '1.235' }
      ])
    ]
  );

  // leitura GET /api/orders retorna options normalizado + options_json retrocompatível
  const listRes = await invoke(ordersController.listOrders, {
    loja: { id: 'loja-1' },
    query: { include: 'items' }
  });
  assert.strictEqual(listRes.statusCode, 200);
  const listOrder = listRes.body.find(order => order.external_id === 'legacy-manual');
  assert.ok(listOrder, 'pedido legado deve aparecer no GET /api/orders');
  assert.ok(Array.isArray(listOrder.items) && listOrder.items.length === 1);

  const listedItem = listOrder.items[0];
  assert.deepStrictEqual(listedItem.options, listedItem.options_json);
  assert.deepStrictEqual(listedItem.options, [
    { option_name: 'Complementos', item_name: 'Queijo extra' },
    { item_name: 'Molho verde', price: 1.24 }
  ]);
  listedItem.options.forEach(assertFlatOptionShape);

  // leitura GET /api/orders/:id retorna options normalizado + options_json retrocompatível
  const getRes = await invoke(ordersController.getOrder, {
    loja: { id: 'loja-1' },
    params: { id: legacyManualOrderId }
  });
  assert.strictEqual(getRes.statusCode, 200);
  assert.ok(Array.isArray(getRes.body.items) && getRes.body.items.length === 1);
  const getItem = getRes.body.items[0];
  assert.deepStrictEqual(getItem.options, getItem.options_json);
  assert.deepStrictEqual(getItem.options, listedItem.options);
  getItem.options.forEach(assertFlatOptionShape);

  // cenário real de pizza no PDV mantém opções após criar e buscar novamente
  const realPizzaOrder = await createPdvTransactional({
    externalId: 'pdv-real-pizza',
    items: [
      {
        product_name: 'Pizza Família',
        quantity: 1,
        unit_price: 95,
        options: [
          {
            name: 'Sabores',
            items: [
              { name: 'calabresa', price: 35 },
              { name: 'mussarela', price: 50 }
            ]
          },
          {
            name: 'Adicionais',
            items: [
              { name: 'aaaa', price: 10 }
            ]
          }
        ]
      }
    ]
  });
  assert.strictEqual(realPizzaOrder.statusCode, 201);
  const realPizzaOrderId = realPizzaOrder.body.order.id;
  const realPizzaPersisted = await db.query('SELECT options_json FROM order_items WHERE order_id = $1', [realPizzaOrderId]);
  assert.deepStrictEqual(JSON.parse(realPizzaPersisted.rows[0].options_json), [
    { option_name: 'Sabores', item_name: 'calabresa', price: 35 },
    { option_name: 'Sabores', item_name: 'mussarela', price: 50 },
    { option_name: 'Adicionais', item_name: 'aaaa', price: 10 }
  ]);

  const realPizzaGetRes = await invoke(ordersController.getOrder, {
    loja: { id: 'loja-1' },
    params: { id: realPizzaOrderId }
  });
  assert.strictEqual(realPizzaGetRes.statusCode, 200);
  assert.deepStrictEqual(realPizzaGetRes.body.items[0].options, [
    { option_name: 'Sabores', item_name: 'calabresa', price: 35 },
    { option_name: 'Sabores', item_name: 'mussarela', price: 50 },
    { option_name: 'Adicionais', item_name: 'aaaa', price: 10 }
  ]);
  assert.deepStrictEqual(realPizzaGetRes.body.items[0].options_json, realPizzaGetRes.body.items[0].options);

  console.log('orders item options integration tests passed');
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
