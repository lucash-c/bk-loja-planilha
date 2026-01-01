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
    query: (text, params) => pool.query(text, params)
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
    }
  };
}

module.exports = db;
