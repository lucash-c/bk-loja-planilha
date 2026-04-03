const db = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

/**
 * CREATE STORE
 * Cria uma nova loja e vincula ao usuário logado
 * Usuário vira OWNER da loja
 */
async function createLoja(req, res, next) {
  try {
    const userId = req.user.id;

    const {
      name,
      whatsapp,
      telefone,
      responsavel_nome,
      email,
      cpf_cnpj,
      pais,
      estado,
      cidade,
      bairro,
      rua,
      numero,
      cep,
      facebook,
      instagram,
      tiktok,
      logo
    } = req.body;

    if (
      !name ||
      !whatsapp ||
      !responsavel_nome ||
      !email ||
      !cpf_cnpj ||
      !pais ||
      !estado ||
      !cidade ||
      !bairro ||
      !rua ||
      !numero ||
      !cep ||
      !logo
    ) {
      return res.status(400).json({
        error: 'Campos obrigatórios não preenchidos'
      });
    }

    const lojaId = uuidv4();
    const publicKey = crypto.randomBytes(16).toString('hex');

    await db.query(
      `
      INSERT INTO lojas (
        id,
        public_key,
        name,
        whatsapp,
        telefone,
        responsavel_nome,
        email,
        cpf_cnpj,
        pais,
        estado,
        cidade,
        bairro,
        rua,
        numero,
        cep,
        facebook,
        instagram,
        tiktok,
        logo,
        is_active
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,TRUE
      )
      `,
      [
        lojaId,
        publicKey,
        name,
        whatsapp,
        telefone || null,
        responsavel_nome,
        email,
        cpf_cnpj,
        pais,
        estado,
        cidade,
        bairro,
        rua,
        numero,
        cep,
        facebook || null,
        instagram || null,
        tiktok || null,
        logo
      ]
    );

    await db.query(
      `
      INSERT INTO user_lojas (
        id,
        user_id,
        loja_id,
        role,
        credits
      )
      VALUES ($1, $2, $3, 'owner', 0)
      `,
      [uuidv4(), userId, lojaId]
    );

    res.status(201).json({
      ok: true,
      loja: {
        id: lojaId,
        name,
        public_key: publicKey
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * LIST STORES
 * Lista lojas do usuário logado
 */
async function listLojas(req, res, next) {
  try {
    const userId = req.user.id;

    const result = await db.query(
      `
      SELECT
        l.id,
        l.name,
        l.whatsapp,
        l.is_active,
        l.public_key,
        ul.role,
        ul.credits
      FROM user_lojas ul
      JOIN lojas l ON l.id = ul.loja_id
      WHERE ul.user_id = $1
      ORDER BY l.created_at DESC
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

/**
 * GET STORE
 * Detalhes completos da loja ativa
 */
async function getLoja(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const include = (req.query.include || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    const result = await db.query(
      `
      SELECT *
      FROM lojas
      WHERE id = $1
      `,
      [lojaId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    const loja = result.rows[0];

    if (include.includes('settings')) {
      loja.settings = await fetchStoreSettings(lojaId);
    }

    if (include.includes('credits')) {
      loja.credits = await fetchStoreCredits(lojaId);
    }

    res.json(loja);
  } catch (err) {
    next(err);
  }
}

/**
 * UPDATE STORE
 * Apenas OWNER pode alterar
 */
async function updateLoja(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const userRole = req.userLoja.role;

    if (userRole !== 'owner') {
      return res.status(403).json({ error: 'Apenas o owner pode alterar a loja' });
    }

    const allowedFields = [
      'name',
      'whatsapp',
      'telefone',
      'responsavel_nome',
      'email',
      'cpf_cnpj',
      'pais',
      'estado',
      'cidade',
      'bairro',
      'rua',
      'numero',
      'cep',
      'facebook',
      'instagram',
      'tiktok',
      'logo'
    ];

    const fields = [];
    const values = [];
    let idx = 1;

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(req.body[field]);
      }
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Nada para atualizar' });
    }

    values.push(lojaId);

    const sql = `
      UPDATE lojas
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await db.query(sql, values);

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

function buildUpdateFields(allowedFields, payload) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const field of allowedFields) {
    if (payload[field] !== undefined) {
      fields.push(`${field} = $${idx++}`);
      values.push(payload[field]);
    }
  }

  return { fields, values, idx };
}

async function adminListLojas(req, res, next) {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        name,
        whatsapp,
        telefone,
        responsavel_nome,
        email,
        cpf_cnpj,
        pais,
        estado,
        cidade,
        bairro,
        rua,
        numero,
        cep,
        facebook,
        instagram,
        tiktok,
        logo,
        is_active,
        public_key,
        created_at
      FROM lojas
      ORDER BY created_at DESC
      `
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
}

async function adminGetLoja(req, res, next) {
  try {
    const lojaId = req.params.id;
    const include = (req.query.include || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean);

    const result = await db.query(
      `
      SELECT *
      FROM lojas
      WHERE id = $1
      `,
      [lojaId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    const loja = result.rows[0];

    if (include.includes('settings')) {
      loja.settings = await fetchStoreSettings(lojaId);
    }

    if (include.includes('credits')) {
      loja.credits = await fetchStoreCredits(lojaId);
    }

    res.json(loja);
  } catch (err) {
    next(err);
  }
}

async function adminUpdateLoja(req, res, next) {
  try {
    const lojaId = req.params.id;
    const allowedFields = [
      'name',
      'whatsapp',
      'telefone',
      'responsavel_nome',
      'email',
      'cpf_cnpj',
      'pais',
      'estado',
      'cidade',
      'bairro',
      'rua',
      'numero',
      'cep',
      'facebook',
      'instagram',
      'tiktok',
      'logo',
      'is_active'
    ];

    const { fields, values, idx } = buildUpdateFields(allowedFields, req.body);

    if (!fields.length) {
      return res.status(400).json({ error: 'Nada para atualizar' });
    }

    values.push(lojaId);

    const sql = `
      UPDATE lojas
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING *
    `;

    const result = await db.query(sql, values);

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

async function adminUpdateLojaStatus(req, res, next) {
  try {
    const lojaId = req.params.id;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ error: 'is_active deve ser booleano' });
    }

    const result = await db.query(
      `
      UPDATE lojas
      SET is_active = $1
      WHERE id = $2
      RETURNING id, is_active
      `,
      [is_active, lojaId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json({ ok: true, loja: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

async function adminDeleteLoja(req, res, next) {
  try {
    const lojaId = req.params.id;
    const result = await db.query(
      `
      DELETE FROM lojas
      WHERE id = $1
      RETURNING id, name
      `,
      [lojaId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json({ ok: true, loja: result.rows[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * REGENERATE PUBLIC KEY
 * Apenas OWNER pode rotacionar
 */
async function regeneratePublicKey(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const userRole = req.userLoja.role;

    if (userRole !== 'owner') {
      return res.status(403).json({ error: 'Apenas o owner pode gerar nova chave' });
    }

    const newKey = crypto.randomBytes(16).toString('hex');

    await db.query(
      `
      UPDATE lojas
      SET public_key = $1
      WHERE id = $2
      `,
      [newKey, lojaId]
    );

    res.json({
      ok: true,
      public_key: newKey
    });
  } catch (err) {
    next(err);
  }
}

async function fetchStoreSettings(lojaId) {
  const result = await db.query(
    `
    SELECT
      mercado_pago_access_token,
      pix_key,
      pix_qr_image,
      open_time,
      close_time,
      is_open
    FROM store_settings
    WHERE loja_id = $1
    `,
    [lojaId]
  );

  if (!result.rows.length) {
    return {
      mercado_pago_access_token: null,
      pix_key: null,
      pix_qr_image: null,
      open_time: null,
      close_time: null,
      is_open: true
    };
  }

  return result.rows[0];
}

async function fetchStoreCredits(lojaId) {
  const { rows } = await db.query(
    `
    SELECT credits
    FROM user_lojas
    WHERE loja_id = $1
      AND role = 'owner'
    LIMIT 1
    `,
    [lojaId]
  );

  if (!rows.length) {
    return 0;
  }

  return Number(rows[0].credits);
}

/**
 * GET STORE SUMMARY
 * Retorna loja + settings + credits
 */
async function getLojaSummary(req, res, next) {
  try {
    const lojaId = req.loja.id;

    const lojaRes = await db.query(
      `
      SELECT *
      FROM lojas
      WHERE id = $1
      `,
      [lojaId]
    );

    if (!lojaRes.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    const [settings, credits] = await Promise.all([
      fetchStoreSettings(lojaId),
      fetchStoreCredits(lojaId)
    ]);

    res.json({
      loja: lojaRes.rows[0],
      settings,
      credits
    });
  } catch (err) {
    next(err);
  }
}

function parseCredits(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

async function ensureUserHasAccess(userId, lojaId) {
  const { rows } = await db.query(
    `
    SELECT role
    FROM user_lojas
    WHERE user_id = $1
      AND loja_id = $2
    `,
    [userId, lojaId]
  );

  return rows[0] || null;
}

/**
 * GET STORE CREDITS (by loja_id)
 */
async function getLojaCredits(req, res, next) {
  try {
    const userId = req.user.id;
    const lojaId = req.params.id;
    const isAdmin = req.user.role === 'admin';

    if (!isAdmin) {
      const access = await ensureUserHasAccess(userId, lojaId);
      if (!access) {
        return res.status(403).json({ error: 'Acesso negado à loja' });
      }
    }

    const { rows } = await db.query(
      `
      SELECT credits
      FROM user_lojas
      WHERE loja_id = $1
        AND role = 'owner'
      LIMIT 1
      `,
      [lojaId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json({ loja_id: lojaId, credits: Number(rows[0].credits) });
  } catch (err) {
    next(err);
  }
}

/**
 * ADD STORE CREDITS (by loja_id)
 * body: { credits }
 */
async function addLojaCredits(req, res, next) {
  try {
    const userId = req.user.id;
    const lojaId = req.params.id;
    const isAdmin = req.user.role === 'admin';

    const credits = parseCredits(req.body.credits ?? req.body.amount);
    if (credits === null) {
      return res.status(400).json({ error: 'credits deve ser um número maior que zero' });
    }

    if (!isAdmin) {
      const access = await ensureUserHasAccess(userId, lojaId);
      if (!access || access.role !== 'owner') {
        return res
          .status(403)
          .json({ error: 'Apenas o owner pode adicionar créditos' });
      }
    }

    const { rows } = await db.query(
      `
      UPDATE user_lojas
      SET credits = credits + $1,
          updated_at = NOW()
      WHERE loja_id = $2
        AND role = 'owner'
      RETURNING credits
      `,
      [credits, lojaId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    res.json({
      ok: true,
      loja_id: lojaId,
      credits_added: credits,
      credits: Number(rows[0].credits)
    });
  } catch (err) {
    next(err);
  }
}

/**
 * CONSUME STORE CREDITS (by loja_id)
 * body: { credits }
 */
async function consumeLojaCredits(req, res, next) {
  try {
    const userId = req.user.id;
    const lojaId = req.params.id;
    const isAdmin = req.user.role === 'admin';

    const credits = parseCredits(req.body.credits ?? req.body.amount);
    if (credits === null) {
      return res.status(400).json({ error: 'credits deve ser um número maior que zero' });
    }

    if (!isAdmin) {
      const access = await ensureUserHasAccess(userId, lojaId);
      if (!access || access.role !== 'owner') {
        return res
          .status(403)
          .json({ error: 'Apenas o owner pode consumir créditos' });
      }
    }

    const { rows } = await db.query(
      `
      UPDATE user_lojas
      SET credits = credits - $1,
          updated_at = NOW()
      WHERE loja_id = $2
        AND role = 'owner'
        AND credits >= $1
      RETURNING credits
      `,
      [credits, lojaId]
    );

    if (!rows.length) {
      const current = await db.query(
        `
        SELECT credits
        FROM user_lojas
        WHERE loja_id = $1
          AND role = 'owner'
        LIMIT 1
        `,
        [lojaId]
      );

      if (!current.rows.length) {
        return res.status(404).json({ error: 'Loja não encontrada' });
      }

      return res.status(400).json({
        error: 'Créditos insuficientes',
        loja_id: lojaId,
        credits: Number(current.rows[0].credits)
      });
    }

    res.json({
      ok: true,
      loja_id: lojaId,
      credits_consumed: credits,
      credits: Number(rows[0].credits)
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createLoja,
  listLojas,
  getLoja,
  updateLoja,
  regeneratePublicKey,
  getLojaSummary,
  getLojaCredits,
  addLojaCredits,
  consumeLojaCredits,
  adminListLojas,
  adminGetLoja,
  adminUpdateLoja,
  adminUpdateLojaStatus,
  adminDeleteLoja
};
