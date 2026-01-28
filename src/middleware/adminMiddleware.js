const db = require('../config/db');

async function requireAdmin(req, res, next) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.user.role) {
      const result = await db.query(
        `
        SELECT role
        FROM users
        WHERE id = $1
        `,
        [req.user.id]
      );

      if (!result.rows.length) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      req.user.role = result.rows[0].role;
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Acesso restrito a administradores' });
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAdmin };
