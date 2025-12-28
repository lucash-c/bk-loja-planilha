const fs = require("fs");
const path = require("path");
const db = require("../src/config/db");

async function runMigration() {
  try {
    const filePath = path.join(__dirname, "../src/sql/schema.sql");
    const sql = fs.readFileSync(filePath, "utf8");

    console.log("📦 Conectado ao PostgreSQL com sucesso!");

    await db.query(sql);

    console.log("Migration executada com sucesso!");
    process.exit(0);
  } catch (err) {
    console.error("Erro ao executar migration:", err);
    process.exit(1);
  }
}

runMigration();
