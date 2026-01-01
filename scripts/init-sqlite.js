const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '../database/dev.db');
const schemaPath = path.join(__dirname, '../database/schema.sqlite.sql');

const db = new Database(dbPath);
const schema = fs.readFileSync(schemaPath, 'utf8');

db.exec(schema);

console.log('✅ SQLite inicializado com sucesso');
