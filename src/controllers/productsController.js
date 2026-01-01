const db = require('../config/db');

/**
 * Criar produto
 * Loja SEMPRE vem do token (req.loja)
 */

/*versao testes no sqlite
async function createProduct(req, res) {
  try {
    const lojaId = req.loja.id;

    let {
      name,
      description,
      base_price,
      image_url,
      has_options = false
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    // Força tipos compatíveis com SQLite/Postgres
    name = String(name);
    description = description != null ? String(description) : null;
    base_price = base_price != null ? Number(base_price) : 0;
    image_url = image_url != null ? String(image_url) : null;
    has_options = has_options ? 1 : 0; // SQLite: 0/1; Postgres aceita true/false, mas 0/1 funciona também

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
      [lojaId, name, description, base_price, image_url, has_options]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Erro ao criar produto:', err);
    return res.status(500).json({ error: 'Erro interno ao criar produto' });
  }
}
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

/**
 * Listar produtos da loja ativa
 */
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

/**
 * Buscar produto por ID (da loja ativa)
 */
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

/**
 * Atualizar produto (da loja ativa)
 */
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

/**
 * Desativar produto (soft delete) da loja ativa
 */
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

module.exports = {
  createProduct,
  listProducts,
  getProductById,
  updateProduct,
  disableProduct
};
