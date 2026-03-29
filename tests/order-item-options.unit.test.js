const assert = require('assert');
const { deserializeOptions } = require('../src/utils/orderItemOptions');

function run() {
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

  console.log('order item options sanitizer tests passed');
}

run();
