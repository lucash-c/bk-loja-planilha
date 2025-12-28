const db = require('../config/db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { sendMail } = require('../utils/mailer');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

async function register(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name } = req.body;
    const exists = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length) return res.status(400).json({ error: 'E-mail já cadastrado' });

    const hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    await db.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)', [id, email, name || null, hash]);
    return res.json({ ok: true, id });
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    const result = await db.query('SELECT id, password_hash, email, name, role FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(400).json({ error: 'Credenciais inválidas' });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ error: 'Credenciais inválidas' });

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role }
    });
  } catch (err) {
    next(err);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email } = req.body;
    const result = await db.query('SELECT id, email, name FROM users WHERE email = $1', [email]);
    if (!result.rows.length) return res.status(200).json({ ok: true }); // don't leak existence

    const user = result.rows[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // salva código (apaga anteriores)
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);
    await db.query('INSERT INTO password_resets (user_id, code, expires_at) VALUES ($1, $2, $3)', [user.id, code, expiresAt]);

    // envia email
    const subject = 'Recuperação de senha - Painel do Restaurante';
    const text = `Olá ${user.name || ''}\n\nSeu código de recuperação é: ${code}\n\nEle expira em 15 minutos.\n\nSe você não solicitou, ignore.`;
    await sendMail({ to: user.email, subject, text });

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, code, newPassword } = req.body;
    const userRes = await db.query('SELECT id FROM users WHERE email = $1', [email]);
    if (!userRes.rows.length) return res.status(400).json({ error: 'E-mail inválido' });

    const user = userRes.rows[0];
    const pr = await db.query('SELECT code, expires_at FROM password_resets WHERE user_id = $1', [user.id]);
    if (!pr.rows.length) return res.status(400).json({ error: 'Código inválido ou expirado' });

    const record = pr.rows[0];
    if (record.code !== code) return res.status(400).json({ error: 'Código inválido' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'Código expirado' });

    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
    await db.query('DELETE FROM password_resets WHERE user_id = $1', [user.id]);

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { register, login, forgotPassword, resetPassword };
