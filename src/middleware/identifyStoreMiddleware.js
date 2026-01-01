const db = require('../config/db');

/**
 * Middleware para identificar a loja
 * Usado em rotas públicas (sem JWT)
 *
 * Prioridade:
 * 1. Header: X-LOJA-KEY
 * 2. Query param: ?loja=
 */
async function identifyStore(req, res, next) {
  try {
    const lojaKey =
      req.headers['x-loja-key'] ||
      req.query.loja;

    if (!lojaKey) {
      return res.status(400).json({
        error: 'Loja não informada'
      });
    }

    /**
     * Busca loja ativa + status de abertura
     */
    const result = await db.query(
      `
      SELECT
        l.id,
        l.name,
        l.is_active,
        COALESCE(ss.is_open, TRUE) AS is_open
      FROM lojas l
      LEFT JOIN store_settings ss ON ss.loja_id = l.id
      WHERE l.public_key = $1
        AND l.is_active = TRUE
      `,
      [lojaKey]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: 'Loja não encontrada ou inativa'
      });
    }

    const loja = result.rows[0];

    req.loja = {
      id: loja.id,
      name: loja.name,
      is_open: loja.is_open
    };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { identifyStore };
