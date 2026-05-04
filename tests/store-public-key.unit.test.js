const assert = require('assert');
const { slugifyStoreName, generateUniqueStorePublicKey } = require('../src/utils/storePublicKey');

async function run() {
  assert.strictEqual(slugifyStoreName('João'), 'joao');
  assert.strictEqual(slugifyStoreName('Açaí'), 'acai');
  assert.strictEqual(slugifyStoreName('Comércio'), 'comercio');
  assert.strictEqual(slugifyStoreName('Açaí & Cia'), 'acaiecia');
  assert.strictEqual(slugifyStoreName('Restaurante do João'), 'restaurantedojoao');
  assert.strictEqual(slugifyStoreName('***'), 'loja');

  const taken = new Set(['restaurantedojoao', 'restaurantedojoao-2']);
  const db = {
    async query(sql, params) {
      const key = params[0];
      const excludedId = params[1];
      if (key === 'restaurantedojoao-3') {
        return { rows: [] };
      }
      if (taken.has(key)) {
        if (key === 'restaurantedojoao' && excludedId === 'loja-1') {
          return { rows: [] };
        }
        return { rows: [{ id: 'taken-id' }] };
      }
      return { rows: [] };
    }
  };

  const unique = await generateUniqueStorePublicKey(db, 'Restaurante do João');
  assert.strictEqual(unique, 'restaurantedojoao-3');

  const selfExcluded = await generateUniqueStorePublicKey(db, 'Restaurante do João', {
    excludeLojaId: 'loja-1'
  });
  assert.strictEqual(selfExcluded, 'restaurantedojoao');

  console.log('Store public key utility tests passed');
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
