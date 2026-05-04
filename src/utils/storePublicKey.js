function slugifyStoreName(name) {
  const normalized = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'e')
    .replace(/[^a-z0-9\s-_]/g, '')
    .replace(/[\s_-]+/g, '')
    .trim();

  return normalized || 'loja';
}

async function generateUniqueStorePublicKey(dbOrTx, storeName, options = {}) {
  const { excludeLojaId = null, maxAttempts = 100 } = options;
  const baseKey = slugifyStoreName(storeName);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = attempt === 1 ? baseKey : `${baseKey}-${attempt}`;
    const params = [candidate];
    let sql = 'SELECT id FROM lojas WHERE public_key = $1';

    if (excludeLojaId) {
      params.push(excludeLojaId);
      sql += ' AND id <> $2';
    }

    const result = await dbOrTx.query(`${sql} LIMIT 1`, params);

    if (!result.rows.length) {
      return candidate;
    }
  }

  throw new Error(`Não foi possível gerar public_key única para "${baseKey}" após ${maxAttempts} tentativas`);
}

module.exports = {
  slugifyStoreName,
  generateUniqueStorePublicKey
};
