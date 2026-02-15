require('dotenv').config();

let db;

if (process.env.DATABASE_URL) {
  // ==========================
  // POSTGRES (produção)
  // ==========================
  const { Pool } = require('pg');

  const useSSL = process.env.PG_SSL === 'true';

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : false
  });

  pool.on('connect', () => {
    console.log('🐘 PostgreSQL conectado');
  });

  db = {
    query: (text, params) => pool.query(text, params),
    withTransaction: async (callback) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          query: (text, params) => client.query(text, params)
        };
        const result = await callback(tx);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          console.error('Erro no rollback da transação', rollbackError);
        }
        throw err;
      } finally {
        client.release();
      }
    },
    supportsForUpdate: true
  };

} else {
  // ==========================
  // SQLITE (dev/local)
  // ==========================
  const Database = require('better-sqlite3');
  const path = require('path');

  const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '../../database/dev.db');
  const sqlite = new Database(dbPath);

  console.log('🟢 SQLite conectado em:', dbPath);

  db = {
    query: (text, params = []) => {
      // Detecta RETURNING
      const hasReturning = /returning\s+\*/i.test(text);

      // Remove RETURNING para SQLite
      const sql = text
        .replace(/returning\s+\*/i, '')
        .replace(/\$\d+/g, '?');

      const stmt = sqlite.prepare(sql);

      // SELECT
      if (/^\s*select/i.test(sql)) {
        return { rows: stmt.all(params) };
      }

      // INSERT / UPDATE / DELETE
      const info = stmt.run(params);

      // Simula RETURNING *
      if (hasReturning) {
        const tableMatch = text.match(/insert\s+into\s+(\w+)/i);

        if (tableMatch) {
          const table = tableMatch[1];
          const row = sqlite
            .prepare(`SELECT * FROM ${table} WHERE id = ?`)
            .get(info.lastInsertRowid);

          return { rows: row ? [row] : [] };
        }
      }

      return {
        rows: [],
        rowCount: info.changes
      };
    },
    withTransaction: async (callback) => {
      sqlite.prepare('BEGIN').run();
      try {
        const result = await callback(db);
        sqlite.prepare('COMMIT').run();
        return result;
      } catch (err) {
        try {
          sqlite.prepare('ROLLBACK').run();
        } catch (rollbackError) {
          console.error('Erro no rollback da transação SQLite', rollbackError);
        }
        throw err;
      }
    },
    supportsForUpdate: false
  };
}

module.exports = db;
