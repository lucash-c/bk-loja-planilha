const jwt = require('jsonwebtoken');
const db = require('../config/db');

async function authenticate(req, res, next) {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = auth.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // 👤 TOKEN DE USUÁRIO (SEM LOJA)
    if (payload.type === 'user') {
      req.user = { id: payload.sub };
      req.tokenType = 'user';
      return next();
    }

    // 🏬 TOKEN DE USUÁRIO + LOJA
    if (payload.type === 'store') {
      const result = await db.query(
        `
        SELECT
          u.id     AS user_id,
          u.email,
          u.name,
          u.role   AS user_role,

          l.id     AS loja_id,
          l.name   AS loja_name,

          ul.role  AS loja_role,
          ul.credits,

          ss.is_open
        FROM users u
        JOIN user_lojas ul ON ul.user_id = u.id
        JOIN lojas l       ON l.id = ul.loja_id
        LEFT JOIN store_settings ss ON ss.loja_id = l.id
        WHERE u.id = $1
          AND l.id = $2
          AND l.is_active = TRUE
        `,
        [payload.sub, payload.loja_id]
      );

      if (!result.rows.length) {
        return res.status(403).json({ error: 'Access denied for this store' });
      }

      const row = result.rows[0];

      req.user = {
        id: row.user_id,
        email: row.email,
        name: row.name,
        role: row.user_role
      };

      req.loja = {
        id: row.loja_id,
        name: row.loja_name,
        is_open: row.is_open
      };

      req.userLoja = {
        role: row.loja_role,
        credits: row.credits
      };

      req.tokenType = 'store';
      return next();
    }

    return res.status(401).json({ error: 'Invalid token' });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { authenticate };
