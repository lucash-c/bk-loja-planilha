import { pool } from '../db.js';

/**
 * ================================
 * PRODUCT OPTIONS
 * ================================
 */

/**
 * Criar opção de produto
 * Ex: Sabores, Adicionais, Bordas
 */
export async function createOption(req, res) {
  const {
    product_id,
    name,
    required = false,
    min_choices = 0,
    max_choices = 1
  } = req.body;

  if (!product_id || !name) {
    return res.status(400).json({
      error: 'product_id e name são obrigatórios'
    });
  }

  try {
    const { rows } = await db.query(
      `
      INSERT INTO product_options (
        product_id,
        name,
        required,
        min_choices,
        max_choices
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        product_id,
        name,
        required,
        min_choices,
        max_choices
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar opção:', err);
    return res.status(500).json({ error: 'Erro interno ao criar opção' });
  }
}

/**
 * Listar opções de um produto
 */
export async function listOptionsByProduct(req, res) {
  const { product_id } = req.params;

  if (!product_id) {
    return res.status(400).json({ error: 'product_id é obrigatório' });
  }

  try {
    const { rows } = await db.query(
      `
      SELECT *
      FROM product_options
      WHERE product_id = $1
      ORDER BY created_at ASC
      `,
      [product_id]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar opções:', err);
    return res.status(500).json({ error: 'Erro interno ao listar opções' });
  }
}

/**
 * Atualizar opção
 */
export async function updateOption(req, res) {
  const { id } = req.params;
  const {
    name,
    required,
    min_choices,
    max_choices
  } = req.body;

  try {
    const { rows } = await db.query(
      `
      UPDATE product_options
      SET
        name = COALESCE($1, name),
        required = COALESCE($2, required),
        min_choices = COALESCE($3, min_choices),
        max_choices = COALESCE($4, max_choices)
      WHERE id = $5
      RETURNING *
      `,
      [
        name,
        required,
        min_choices,
        max_choices,
        id
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Opção não encontrada' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar opção:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar opção' });
  }
}

/**
 * Remover opção (hard delete)
 * ⚠️ Remove também os itens vinculados (cascade)
 */
export async function deleteOption(req, res) {
  const { id } = req.params;

  try {
    const { rowCount } = await db.query(
      `
      DELETE FROM product_options
      WHERE id = $1
      `,
      [id]
    );

    if (!rowCount) {
      return res.status(404).json({ error: 'Opção não encontrada' });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Erro ao remover opção:', err);
    return res.status(500).json({ error: 'Erro interno ao remover opção' });
  }
}

/**
 * ================================
 * OPTION ITEMS
 * ================================
 */

/**
 * Criar item da opção
 * Ex: Calabresa, Bacon, Catupiry
 */
export async function createOptionItem(req, res) {
  const {
    option_id,
    name,
    price = 0
  } = req.body;

  if (!option_id || !name) {
    return res.status(400).json({
      error: 'option_id e name são obrigatórios'
    });
  }

  try {
    const { rows } = await db.query(
      `
      INSERT INTO product_option_items (
        option_id,
        name,
        price
      )
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [
        option_id,
        name,
        price
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar item da opção:', err);
    return res.status(500).json({ error: 'Erro interno ao criar item da opção' });
  }
}

/**
 * Listar itens de uma opção
 */
export async function listOptionItems(req, res) {
  const { option_id } = req.params;

  if (!option_id) {
    return res.status(400).json({ error: 'option_id é obrigatório' });
  }

  try {
    const { rows } = await db.query(
      `
      SELECT *
      FROM product_option_items
      WHERE option_id = $1
        AND is_active = true
      ORDER BY name ASC
      `,
      [option_id]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar itens:', err);
    return res.status(500).json({ error: 'Erro interno ao listar itens' });
  }
}

/**
 * Atualizar item da opção
 */
export async function updateOptionItem(req, res) {
  const { id } = req.params;
  const {
    name,
    price,
    is_active
  } = req.body;

  try {
    const { rows } = await db.query(
      `
      UPDATE product_option_items
      SET
        name = COALESCE($1, name),
        price = COALESCE($2, price),
        is_active = COALESCE($3, is_active)
      WHERE id = $4
      RETURNING *
      `,
      [
        name,
        price,
        is_active,
        id
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar item:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar item' });
  }
}

/**
 * Remover item da opção (soft delete)
 */
export async function disableOptionItem(req, res) {
  const { id } = req.params;

  try {
    const { rows } = await db.query(
      `
      UPDATE product_option_items
      SET is_active = false
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao desativar item:', err);
    return res.status(500).json({ error: 'Erro interno ao desativar item' });
  }
}
