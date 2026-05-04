const db = require('../src/config/db');
const { generateUniqueStorePublicKey } = require('../src/utils/storePublicKey');

async function runBackfill() {
  const stores = await db.query(
    `
    SELECT id, name, public_key
    FROM lojas
    ORDER BY created_at ASC, id ASC
    `
  );

  let updatedCount = 0;

  for (const store of stores.rows) {
    const nextPublicKey = await generateUniqueStorePublicKey(db, store.name, {
      excludeLojaId: store.id
    });

    if (nextPublicKey === store.public_key) {
      continue;
    }

    await db.query(
      `
      UPDATE lojas
      SET public_key = $1
      WHERE id = $2
      `,
      [nextPublicKey, store.id]
    );

    updatedCount += 1;
    console.log(`[UPDATED] id=${store.id} name="${store.name}" old="${store.public_key}" new="${nextPublicKey}"`);
  }

  console.log(`Backfill concluído. Lojas analisadas: ${stores.rows.length}. Atualizadas: ${updatedCount}.`);
}

runBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro no backfill de public_key das lojas:', err.message);
    process.exit(1);
  });
