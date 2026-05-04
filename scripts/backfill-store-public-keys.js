const db = require('../src/config/db');
const { generateUniqueStorePublicKey } = require('../src/utils/storePublicKey');

async function runBackfill() {
  let updatedCount = 0;
  let totalStores = 0;

  await db.withTransaction(async tx => {
    const stores = await tx.query(
      `
      SELECT id, name, public_key
      FROM lojas
      ORDER BY created_at ASC, id ASC
      `
    );
    totalStores = stores.rows.length;

    for (const store of stores.rows) {
      const nextPublicKey = await generateUniqueStorePublicKey(tx, store.name, {
        excludeLojaId: store.id
      });

      if (nextPublicKey === store.public_key) {
        continue;
      }

      await tx.query(
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
  });

  console.log(`Backfill concluído. Lojas analisadas: ${totalStores}. Atualizadas: ${updatedCount}.`);
}

runBackfill()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Erro no backfill de public_key das lojas:', err.message);
    process.exit(1);
  });
