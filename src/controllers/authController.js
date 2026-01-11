const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { sendMail } = require('../utils/mailer');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

/**
 * REGISTER
 */
async function register(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, name } = req.body;

    const exists = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (exists.rows.length) {
      return res.status(400).json({ error: 'E-mail já cadastrado' });
    }

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();

    await db.query(
      `
      INSERT INTO users (id, email, name, password_hash)
      VALUES ($1, $2, $3, $4)
      `,
      [id, email, name || null, hash]
    );

    res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
}

/**
 * LOGIN
 * Gera TOKEN DE USUÁRIO (SEM LOJA)
 */
async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const result = await db.query(
      `
      SELECT id, password_hash, email, name, role
      FROM users
      WHERE email = $1
      `,
      [email]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: 'Credenciais inválidas' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) {
      return res.status(400).json({ error: 'Credenciais inválidas' });
    }

    // 🔑 TOKEN SOMENTE DE USUÁRIO
    const token = jwt.sign(
      {
        sub: user.id,
        type: 'user'
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_USER_EXPIRES_IN || '8h' }
    );

    const lojasRes = await db.query(
      `
      SELECT
        l.id,
        l.name,
        l.is_active,
        ul.role AS user_role
      FROM user_lojas ul
      JOIN lojas l ON l.id = ul.loja_id
      WHERE ul.user_id = $1
        AND l.is_active = TRUE
      `,
      [user.id]
    );

    res.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      lojas: lojasRes.rows
    });
  } catch (err) {
    next(err);
  }
}

/**
 * SELECT STORE
 * Gera TOKEN DE USUÁRIO + LOJA
 */
async function selectStore(req, res, next) {
  try {
    const userId = req.user.id;
    const { loja_id } = req.body;

    if (!loja_id) {
      return res.status(400).json({ error: 'Loja não informada' });
    }

    const result = await db.query(
      `
      SELECT
        u.id AS user_id,
        u.email,
        u.name,       
        u.role AS user_role,

        l.id AS loja_id,
        l.name AS loja_name,
        l.public_key,

        ul.role AS loja_role
      FROM users u
      JOIN user_lojas ul ON ul.user_id = u.id
      JOIN lojas l ON l.id = ul.loja_id
      WHERE u.id = $1
        AND l.id = $2
        AND l.is_active = TRUE
      `,
      [userId, loja_id]
    );

    if (!result.rows.length) {
      return res.status(403).json({ error: 'Acesso negado à loja' });
    }

    const data = result.rows[0];

    const token = jwt.sign(
      {
        sub: data.user_id,
        loja_id: data.loja_id,
        role: data.user_role,
        loja_role: data.loja_role,
        type: 'store'
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({
      ok: true,
      token,
      loja: {
        id: data.loja_id,
        name: data.loja_name,
        public_key: data.public_key
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * FORGOT PASSWORD
 */
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;

    const result = await db.query(
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );

    if (!result.rows.length) {
      return res.json({ ok: true });
    }

    const user = result.rows[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await db.query(
      `
      INSERT INTO password_resets (user_id, code, expires_at)
      VALUES ($1, $2, $3)
      `,
      [user.id, code, expiresAt]
    );

    await sendMail({
      to: user.email,
      subject: 'Recuperação de senha',
      text: `Seu código é: ${code}`
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * RESET PASSWORD
 */
async function resetPassword(req, res, next) {
  try {
    const { email, code, newPassword } = req.body;

    const userRes = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (!userRes.rows.length) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }

    const user = userRes.rows[0];

    const pr = await db.query(
      `
      SELECT code, expires_at
      FROM password_resets
      WHERE user_id = $1
      `,
      [user.id]
    );

    if (!pr.rows.length || pr.rows[0].code !== code) {
      return res.status(400).json({ error: 'Código inválido' });
    }

    if (new Date(pr.rows[0].expires_at) < new Date()) {
      return res.status(400).json({ error: 'Código expirado' });
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [hash, user.id]
    );

    await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  selectStore,
  forgotPassword,
  resetPassword
};
