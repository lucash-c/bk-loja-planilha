const db = require('../config/db');

/**
 * ============================
 * PRODUTOS
 * ============================
 */

async function createProduct(req, res) {
  try {
    const lojaId = req.loja.id;

    const {
      name,
      description,
      base_price,
      image_url,
      has_options = false
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    const { rows } = await db.query(
      `
      INSERT INTO products (
        loja_id,
        name,
        description,
        base_price,
        image_url,
        has_options
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        lojaId,
        name,
        description || null,
        base_price || 0,
        image_url || null,
        has_options
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar produto:', err);
    return res.status(500).json({ error: 'Erro interno ao criar produto' });
  }
}

async function listProducts(req, res) {
  try {
    const lojaId = req.loja.id;
    const { active } = req.query;

    let query = `
      SELECT *
      FROM products
      WHERE loja_id = $1
    `;
    const params = [lojaId];

    if (active === 'true') {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY created_at DESC';

    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar produtos:', err);
    return res.status(500).json({ error: 'Erro interno ao listar produtos' });
  }
}

async function getProductById(req, res) {
  try {
    const lojaId = req.loja.id;
    const { id } = req.params;

    const { rows } = await db.query(
      `
      SELECT *
      FROM products
      WHERE id = $1
        AND loja_id = $2
      `,
      [id, lojaId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao buscar produto:', err);
    return res.status(500).json({ error: 'Erro interno ao buscar produto' });
  }
}

async function updateProduct(req, res) {
  try {
    const lojaId = req.loja.id;
    const { id } = req.params;

    const {
      name,
      description,
      base_price,
      image_url,
      has_options,
      is_active
    } = req.body;

    const { rows } = await db.query(
      `
      UPDATE products
      SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        base_price = COALESCE($3, base_price),
        image_url = COALESCE($4, image_url),
        has_options = COALESCE($5, has_options),
        is_active = COALESCE($6, is_active)
      WHERE id = $7
        AND loja_id = $8
      RETURNING *
      `,
      [
        name,
        description,
        base_price,
        image_url,
        has_options,
        is_active,
        id,
        lojaId
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar produto:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar produto' });
  }
}

async function disableProduct(req, res) {
  try {
    const lojaId = req.loja.id;
    const { id } = req.params;

    const { rows } = await db.query(
      `
      UPDATE products
      SET is_active = false
      WHERE id = $1
        AND loja_id = $2
      RETURNING *
      `,
      [id, lojaId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao desativar produto:', err);
    return res.status(500).json({ error: 'Erro interno ao desativar produto' });
  }
}

/**
 * ============================
 * OPÇÕES DE PRODUTO (OPÇÃO A)
 * ============================
 */

// Criar opção para um produto
async function createProductOption(req, res) {
  try {
    const lojaId = req.loja.id;
    const { productId } = req.params;

    const {
      name,
      type = 'single',
      required = false,
      min_choices = 0,
      max_choices = 1
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    // Garante que o produto pertence à loja
    const productCheck = await db.query(
      `SELECT id FROM products WHERE id = $1 AND loja_id = $2`,
      [productId, lojaId]
    );

    if (!productCheck.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const { rows } = await db.query(
      `
      INSERT INTO product_options (
        product_id,
        name,
        type,
        required,
        min_choices,
        max_choices
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        productId,
        name,
        type,
        required,
        min_choices,
        max_choices
      ]
    );

    // Marca produto como tendo opções
    await db.query(
      `UPDATE products SET has_options = true WHERE id = $1`,
      [productId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar opção do produto:', err);
    return res.status(500).json({ error: 'Erro interno ao criar opção' });
  }
}

// Listar opções de um produto
async function listProductOptions(req, res) {
  try {
    const lojaId = req.loja.id;
    const { productId } = req.params;

    const productCheck = await db.query(
      `SELECT id FROM products WHERE id = $1 AND loja_id = $2`,
      [productId, lojaId]
    );

    if (!productCheck.rows.length) {
      return res.status(404).json({ error: 'Produto não encontrado' });
    }

    const { rows } = await db.query(
      `
      SELECT *
      FROM product_options
      WHERE product_id = $1
      ORDER BY created_at ASC
      `,
      [productId]
    );

    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar opções do produto:', err);
    return res.status(500).json({ error: 'Erro interno ao listar opções' });
  }
}

// Criar item de opção
async function createProductOptionItem(req, res) {
  try {
    const lojaId = req.loja.id;
    const { optionId } = req.params;

    const { name, price = 0, is_active = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    // Valida se a opção pertence a um produto da loja
    const optionCheck = await db.query(
      `
      SELECT po.id
      FROM product_options po
      JOIN products p ON p.id = po.product_id
      WHERE po.id = $1
        AND p.loja_id = $2
      `,
      [optionId, lojaId]
    );

    if (!optionCheck.rows.length) {
      return res.status(404).json({ error: 'Opção não encontrada' });
    }

    const { rows } = await db.query(
      `
      INSERT INTO product_option_items (
        option_id,
        name,
        price,
        is_active
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [
        optionId,
        name,
        price,
        is_active
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar item da opção:', err);
    return res.status(500).json({ error: 'Erro interno ao criar item da opção' });
  }
}

module.exports = {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  disableProduct,

  createProductOption,
  listProductOptions,
  createProductOptionItem
};
