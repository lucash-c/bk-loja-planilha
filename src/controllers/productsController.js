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
      has_options = false,
      is_visible = true
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
        has_options,
        is_visible
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [
        lojaId,
        name,
        description || null,
        base_price || 0,
        image_url || null,
        has_options,
        is_visible
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
    const { active, visible } = req.query;

    let query = `
      SELECT *
      FROM products
      WHERE loja_id = $1
    `;
    const params = [lojaId];

    if (active === 'true') query += ' AND is_active = true';
    if (visible === 'true') query += ' AND is_visible = true';

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
      is_active,
      is_visible
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
        is_active = COALESCE($6, is_active),
        is_visible = COALESCE($7, is_visible)
      WHERE id = $8
        AND loja_id = $9
      RETURNING *
      `,
      [
        name,
        description,
        base_price,
        image_url,
        has_options,
        is_active,
        is_visible,
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
 * OPÇÕES DE PRODUTO
 * ============================
 */

async function createProductOption(req, res) {
  try {
    const lojaId = req.loja.id;
    const { productId } = req.params;

    const {
      name,
      type = 'single',
      required = false,
      min_choices = 0,
      max_choices = 1,
      is_visible = true
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

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
        max_choices,
        is_visible
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
      `,
      [productId, name, type, required, min_choices, max_choices, is_visible]
    );

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

async function listProductOptions(req, res) {
  try {
    const lojaId = req.loja.id;
    const { productId } = req.params;
    const { visible } = req.query;

    let query = `
      SELECT po.*
      FROM product_options po
      JOIN products p ON p.id = po.product_id
      WHERE po.product_id = $1
        AND p.loja_id = $2
    `;
    const params = [productId, lojaId];

    if (visible === 'true') query += ' AND po.is_visible = true';

    query += ' ORDER BY po.created_at ASC';

    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar opções:', err);
    return res.status(500).json({ error: 'Erro interno ao listar opções' });
  }
}

/**
 * ============================
 * ITENS DE OPÇÃO
 * ============================
 */

async function listProductOptionItems(req, res) {
  try {
    const lojaId = req.loja.id;
    const { optionId } = req.params;
    const { visible } = req.query;

    let query = `
      SELECT poi.*
      FROM product_option_items poi
      JOIN product_options po ON po.id = poi.option_id
      JOIN products p ON p.id = po.product_id
      WHERE poi.option_id = $1
        AND p.loja_id = $2
        AND poi.is_active = true
    `;
    const params = [optionId, lojaId];

    if (visible === 'true') query += ' AND poi.is_visible = true';

    query += ' ORDER BY poi.name ASC';

    const { rows } = await db.query(query, params);
    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar itens da opção:', err);
    return res.status(500).json({ error: 'Erro interno ao listar itens' });
  }
}

async function createProductOptionItem(req, res) {
  try {
    const lojaId = req.loja.id;
    const { optionId } = req.params;

    const {
      name,
      price = 0,
      is_active = true,
      is_visible = true
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

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
        is_active,
        is_visible
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [optionId, name, price, is_active, is_visible]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar item da opção:', err);
    return res.status(500).json({ error: 'Erro interno ao criar item da opção' });
  }
}

async function updateProductOptionItem(req, res) {
  try {
    const lojaId = req.loja.id;
    const { optionId, itemId } = req.params;
    const {
      name,
      price,
      is_active,
      is_visible
    } = req.body;

    const { rows } = await db.query(
      `
      UPDATE product_option_items poi
      SET
        name = COALESCE($1, poi.name),
        price = COALESCE($2, poi.price),
        is_active = COALESCE($3, poi.is_active),
        is_visible = COALESCE($4, poi.is_visible)
      FROM product_options po
      JOIN products p ON p.id = po.product_id
      WHERE poi.id = $5
        AND poi.option_id = po.id
        AND po.id = $6
        AND p.loja_id = $7
      RETURNING poi.*
      `,
      [
        name,
        price,
        is_active,
        is_visible,
        itemId,
        optionId,
        lojaId
      ]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar item da opção:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar item' });
  }
}

async function deleteProductOptionItem(req, res) {
  try {
    const lojaId = req.loja.id;
    const { optionId, itemId } = req.params;

    const { rows } = await db.query(
      `
      UPDATE product_option_items poi
      SET is_active = false
      FROM product_options po
      JOIN products p ON p.id = po.product_id
      WHERE poi.id = $1
        AND poi.option_id = po.id
        AND po.id = $2
        AND p.loja_id = $3
      RETURNING poi.*
      `,
      [itemId, optionId, lojaId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Item não encontrado' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao remover item da opção:', err);
    return res.status(500).json({ error: 'Erro interno ao remover item' });
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
  listProductOptionItems,
  createProductOptionItem,
  updateProductOptionItem,
  deleteProductOptionItem
};
