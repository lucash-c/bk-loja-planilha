const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.join(__dirname, 'dev.db');
const schemaPath = path.join(__dirname, 'schema.sqlite.sql');

const schema = fs.readFileSync(schemaPath, 'utf8');

const db = new sqlite3.Database(dbPath);

db.exec(schema, (err) => {
  if (err) {
    console.error('Erro ao criar schema:', err.message);
    process.exit(1);
  }

  console.log('Banco recriado com sucesso!');
  db.close();
});
