const { v4: uuidv4 } = require('uuid');
const db = require('../config/db');

const ALLOWED_CODES = new Set(['pix', 'dinheiro', 'credito', 'debito', 'vr', 'va']);

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'sim'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'não'].includes(normalized)) return false;
  }

  return fallback;
}

function sanitizeCode(code) {
  return String(code || '').trim().toLowerCase();
}

function toDbBoolean(value) {
  const normalized = normalizeBoolean(value, false);
  return process.env.DATABASE_URL ? normalized : (normalized ? 1 : 0);
}

function assertOwner(req, res) {
  const userRole = req.userLoja?.role;
  if (userRole !== 'owner') {
    res.status(403).json({ error: 'Apenas o owner pode alterar formas de pagamento' });
    return false;
  }

  return true;
}

async function getPaymentMethodById(lojaId, id) {
  const result = await db.query(
    `
    SELECT *
    FROM store_payment_methods
    WHERE id = $1
      AND loja_id = $2
    LIMIT 1
    `,
    [id, lojaId]
  );

  return result.rows[0] || null;
}

async function listPaymentMethods(req, res, next) {
  try {
    const lojaId = req.loja.id;

    const result = await db.query(
      `
      SELECT
        id,
        loja_id,
        code,
        label,
        is_active,
        sort_order,
        requires_change,
        created_at,
        updated_at
      FROM store_payment_methods
      WHERE loja_id = $1
      ORDER BY sort_order ASC, label ASC
      `,
      [lojaId]
    );

    res.json({ payment_methods: result.rows });
  } catch (err) {
    next(err);
  }
}

async function createPaymentMethod(req, res, next) {
  try {
    if (!assertOwner(req, res)) return;

    const lojaId = req.loja.id;
    const code = sanitizeCode(req.body.code);
    const label = String(req.body.label || '').trim();

    if (!code) {
      return res.status(400).json({ error: 'Campo "code" é obrigatório' });
    }

    if (!ALLOWED_CODES.has(code)) {
      return res.status(400).json({ error: 'Forma de pagamento inválida para o campo "code"' });
    }

    if (!label) {
      return res.status(400).json({ error: 'Campo "label" é obrigatório' });
    }

    const sortOrder = Number.isInteger(Number(req.body.sort_order))
      ? Number(req.body.sort_order)
      : 0;

    const requiresChange = toDbBoolean(req.body.requires_change);
    const isActive = req.body.is_active === undefined
      ? (process.env.DATABASE_URL ? true : 1)
      : toDbBoolean(req.body.is_active);
    const id = uuidv4();

    await db.query(
      `
      INSERT INTO store_payment_methods (
        id,
        loja_id,
        code,
        label,
        is_active,
        sort_order,
        requires_change
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [id, lojaId, code, label, isActive, sortOrder, requiresChange]
    );

    const paymentMethod = await getPaymentMethodById(lojaId, id);
    res.status(201).json({ ok: true, payment_method: paymentMethod });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.code === '23505') {
      return res.status(409).json({ error: 'Forma de pagamento já cadastrada para esta loja' });
    }

    next(err);
  }
}

async function updatePaymentMethod(req, res, next) {
  try {
    if (!assertOwner(req, res)) return;

    const lojaId = req.loja.id;
    const { id } = req.params;

    const current = await getPaymentMethodById(lojaId, id);

    if (!current) {
      return res.status(404).json({ error: 'Forma de pagamento não encontrada' });
    }

    const nextCode = req.body.code === undefined ? current.code : sanitizeCode(req.body.code);
    const nextLabel = req.body.label === undefined ? current.label : String(req.body.label || '').trim();

    if (!nextCode || !ALLOWED_CODES.has(nextCode)) {
      return res.status(400).json({ error: 'Forma de pagamento inválida para o campo "code"' });
    }

    if (!nextLabel) {
      return res.status(400).json({ error: 'Campo "label" é obrigatório' });
    }

    const parsedSortOrder = Number(req.body.sort_order);
    const nextSortOrder = req.body.sort_order === undefined || Number.isNaN(parsedSortOrder)
      ? Number(current.sort_order || 0)
      : parsedSortOrder;

    const nextIsActive = req.body.is_active === undefined
      ? current.is_active
      : toDbBoolean(req.body.is_active);

    const nextRequiresChange = req.body.requires_change === undefined
      ? current.requires_change
      : toDbBoolean(req.body.requires_change);

    await db.query(
      `
      UPDATE store_payment_methods
      SET
        code = $1,
        label = $2,
        is_active = $3,
        sort_order = $4,
        requires_change = $5,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
        AND loja_id = $7
      `,
      [
        nextCode,
        nextLabel,
        nextIsActive,
        nextSortOrder,
        nextRequiresChange,
        id,
        lojaId
      ]
    );

    const paymentMethod = await getPaymentMethodById(lojaId, id);
    res.json({ ok: true, payment_method: paymentMethod });
  } catch (err) {
    if (err.message?.includes('UNIQUE') || err.code === '23505') {
      return res.status(409).json({ error: 'Forma de pagamento já cadastrada para esta loja' });
    }

    next(err);
  }
}

async function deletePaymentMethod(req, res, next) {
  try {
    if (!assertOwner(req, res)) return;

    const lojaId = req.loja.id;
    const { id } = req.params;

    const current = await getPaymentMethodById(lojaId, id);
    if (!current) {
      return res.status(404).json({ error: 'Forma de pagamento não encontrada' });
    }

    await db.query(
      `
      UPDATE store_payment_methods
      SET
        is_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND loja_id = $2
      `,
      [id, lojaId]
    );

    const paymentMethod = await getPaymentMethodById(lojaId, id);
    res.json({ ok: true, payment_method: paymentMethod });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod
};
