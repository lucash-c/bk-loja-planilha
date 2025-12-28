const { Pool } = require("pg");
require("dotenv").config();

const useSSL = process.env.PG_SSL === "true";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSSL
    ? { rejectUnauthorized: false } // SSL para VPS/EasyPanel
    : false // sem SSL para conexões locais
});

pool.on("connect", () => {
  console.log("📦 Conectado ao PostgreSQL com sucesso!");
});

pool.on("error", (err) => {
  console.error("❌ Erro inesperado no cliente idle do PostgreSQL:", err);
  process.exit(-1);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
