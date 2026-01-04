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

    // validações obrigatórias
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

    // cria loja
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

    // vínculo usuário ↔ loja (owner)
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

    res.json(result.rows[0]);
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
      'logo',
      'is_active'
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

module.exports = {
  createLoja,
  listLojas,
  getLoja,
  updateLoja,
  regeneratePublicKey
};
