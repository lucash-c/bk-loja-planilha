const assert = require('assert');
const { deserializeOptions, resolveOrderItemOptions } = require('../src/utils/orderItemOptions');

function run() {
  // flat canonical + whitelist + sanitization
  const options = deserializeOptions([
    {
      option_id: 123,
      option_name: '  Borda recheada  ',
      item_id: null,
      item_name: ' Catupiry ',
      price: '4.567',
      created_at: '2026-01-01',
      _meta: { trace: true }
    },
    {
      option_id: 'grp-1',
      option_name: '   ',
      item_id: 'opt-1',
      item_name: '  ',
      price: 'abc',
      raw: { from: 'middleware' }
    },
    'not-an-object',
    {
      option_id: 'grp-2',
      option_name: 'Molho',
      item_id: 'opt-2',
      item_name: 'Barbecue',
      price: 2,
      nested: { technical: true }
    }
  ]);

  assert.deepStrictEqual(options, [
    {
      option_id: '123',
      option_name: 'Borda recheada',
      item_name: 'Catupiry',
      price: 4.57
    },
    {
      option_id: 'grp-2',
      option_name: 'Molho',
      item_id: 'opt-2',
      item_name: 'Barbecue',
      price: 2
    }
  ]);

  // grouped shape support
  const grouped = resolveOrderItemOptions({
    options: [
      {
        name: 'Sabores',
        items: [
          { name: 'calabresa', price: 35 },
          { name: 'mussarela', price: 50 }
        ]
      },
      {
        group_name: 'Adicionais',
        selected_items: [
          { item_name: 'aaaa', price: 10 }
        ]
      }
    ]
  });

  assert.deepStrictEqual(grouped, [
    { option_name: 'Sabores', item_name: 'calabresa', price: 35 },
    { option_name: 'Sabores', item_name: 'mussarela', price: 50 },
    { option_name: 'Adicionais', item_name: 'aaaa', price: 10 }
  ]);

  // container shape support
  const container = resolveOrderItemOptions({
    options_json: JSON.stringify({
      options: [
        {
          option_id: 'grp-1',
          option_name: 'Sabores',
          option_items: [
            { item_id: 'i-1', name: 'calabresa', additional_price: '35.00' }
          ]
        }
      ]
    })
  });

  assert.deepStrictEqual(container, [
    {
      option_id: 'grp-1',
      option_name: 'Sabores',
      item_id: 'i-1',
      item_name: 'calabresa',
      price: 35
    }
  ]);

  // camelCase compatibility for legacy payloads
  const fromCamelCase = resolveOrderItemOptions({
    optionsJson: JSON.stringify({
      groups: [
        {
          optionGroupId: 'grp-camel',
          label: 'Bebidas',
          selectedOptions: [
            { optionItemId: 'itm-coke', title: 'Coca 2L', extra_price: '7.5' }
          ]
        }
      ]
    })
  });

  assert.deepStrictEqual(fromCamelCase, [
    {
      option_id: 'grp-camel',
      option_name: 'Bebidas',
      item_id: 'itm-coke',
      item_name: 'Coca 2L',
      price: 7.5
    }
  ]);

  // snake_case options_json has precedence over camelCase optionsJson
  const snakePrecedence = resolveOrderItemOptions({
    options_json: JSON.stringify([
      { option_name: 'Tamanho', item_name: 'Grande', price: 3 }
    ]),
    optionsJson: JSON.stringify([
      { option_name: 'Tamanho', item_name: 'Pequeno', price: 1 }
    ])
  });

  assert.deepStrictEqual(snakePrecedence, [
    { option_name: 'Tamanho', item_name: 'Grande', price: 3 }
  ]);

  const fromJson = deserializeOptions(
    JSON.stringify([
      {
        option_name: 'Tamanho',
        item_name: 'Grande',
        price: '3.9999',
        updated_at: 'x'
      }
    ])
  );

  assert.deepStrictEqual(fromJson, [
    {
      option_name: 'Tamanho',
      item_name: 'Grande',
      price: 4
    }
  ]);

  assert.deepStrictEqual(
    resolveOrderItemOptions({
      options: 'invalid',
      options_json: '{not-json'
    }),
    []
  );

  const fromObject = deserializeOptions({
    options: [
      {
        option_name: 'Massa',
        items: [{ name: 'Pan', price: '2.00' }]
      }
    ]
  });

  assert.deepStrictEqual(fromObject, [
    {
      option_name: 'Massa',
      item_name: 'Pan',
      price: 2
    }
  ]);

  // reject technical garbage (explicit grouped items key must be array)
  const groupedGarbage = resolveOrderItemOptions({
    options: [
      {
        option_name: 'Molhos',
        item_name: 'Ketchup',
        items: { id: 'bad-shape' }
      }
    ]
  });
  assert.deepStrictEqual(groupedGarbage, []);

  console.log('order item options sanitizer tests passed');
}

run();
