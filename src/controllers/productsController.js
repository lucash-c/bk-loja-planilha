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
      category_id,
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
        category_id,
        name,
        description,
        base_price,
        image_url,
        has_options,
        is_visible
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        lojaId,
        category_id || null,
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
      category_id,
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
        category_id = COALESCE($5, category_id),
        has_options = COALESCE($6, has_options),
        is_active = COALESCE($7, is_active),
        is_visible = COALESCE($8, is_visible)
      WHERE id = $9
        AND loja_id = $10
      RETURNING *
      `,
      [
        name,
        description,
        base_price,
        image_url,
        category_id,
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
      DELETE FROM products
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
  const include = (req.query.include || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const includeItems = include.includes('items');
  const includeOptionGroups =
    include.includes('option_groups') || include.includes('option-groups');

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

    let optionsPayload = rows;

    if (includeItems && rows.length) {
      const optionIds = rows.map(option => option.id);
      const placeholders = optionIds
        .map((_, index) => `$${index + 1}`)
        .join(',');
      let itemsQuery = `
        SELECT poi.*
        FROM product_option_items poi
        WHERE poi.option_id IN (${placeholders})
          AND poi.is_active = true
      `;

      if (visible === 'true') {
        itemsQuery += ' AND poi.is_visible = true';
      }

      itemsQuery += ' ORDER BY poi.name ASC';

      const itemsRes = await db.query(itemsQuery, optionIds);
      const itemsByOption = new Map();

      for (const item of itemsRes.rows) {
        if (!itemsByOption.has(item.option_id)) {
          itemsByOption.set(item.option_id, []);
        }
        itemsByOption.get(item.option_id).push(item);
      }

      optionsPayload = rows.map(option => ({
        ...option,
        items: itemsByOption.get(option.id) || []
      }));
    }

    if (!includeOptionGroups) {
      return res.json(optionsPayload);
    }

    const optionGroupsRes = await db.query(
      `
      SELECT og.*
      FROM option_groups og
      JOIN product_option_groups pog
        ON pog.option_group_id = og.id
      WHERE pog.product_id = $1
        AND og.loja_id = $2
        AND og.is_active = true
      ORDER BY og.created_at ASC
      `,
      [productId, lojaId]
    );

    const optionGroupIds = optionGroupsRes.rows.map(group => group.id);
    let optionGroupsPayload = optionGroupsRes.rows;

    if (optionGroupIds.length) {
      const groupPlaceholders = optionGroupIds
        .map((_, index) => `$${index + 1}`)
        .join(',');
      let groupItemsQuery = `
        SELECT ogi.*
        FROM option_group_items ogi
        WHERE ogi.option_group_id IN (${groupPlaceholders})
          AND ogi.is_active = true
      `;

      if (visible === 'true') {
        groupItemsQuery += ' AND ogi.is_visible = true';
      }

      groupItemsQuery += ' ORDER BY ogi.name ASC';

      const groupItemsRes = await db.query(groupItemsQuery, optionGroupIds);
      const itemsByGroup = new Map();

      for (const item of groupItemsRes.rows) {
        if (!itemsByGroup.has(item.option_group_id)) {
          itemsByGroup.set(item.option_group_id, []);
        }
        itemsByGroup.get(item.option_group_id).push(item);
      }

      optionGroupsPayload = optionGroupsRes.rows.map(group => ({
        ...group,
        items: itemsByGroup.get(group.id) || []
      }));
    }

    return res.json({
      options: optionsPayload,
      option_groups: optionGroupsPayload
    });
  } catch (err) {
    console.error('Erro ao listar opções:', err);
    return res.status(500).json({ error: 'Erro interno ao listar opções' });
  }
}

async function updateProductOption(req, res) {
  try {
    const lojaId = req.loja.id;
    const { productId, optionId } = req.params;

    const {
      name,
      type,
      required,
      min_choices,
      max_choices,
      is_visible
    } = req.body;

    const { rows } = await db.query(
      `
      UPDATE product_options po
      SET
        name = COALESCE($1, po.name),
        type = COALESCE($2, po.type),
        required = COALESCE($3, po.required),
        min_choices = COALESCE($4, po.min_choices),
        max_choices = COALESCE($5, po.max_choices),
        is_visible = COALESCE($6, po.is_visible)
      FROM products p
      WHERE po.id = $7
        AND po.product_id = $8
        AND p.id = po.product_id
        AND p.loja_id = $9
      RETURNING po.*
      `,
      [
        name,
        type,
        required,
        min_choices,
        max_choices,
        is_visible,
        optionId,
        productId,
        lojaId
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

async function deleteProductOption(req, res) {
  try {
    const lojaId = req.loja.id;
    const { productId, optionId } = req.params;

    const { rows } = await db.query(
      `
      DELETE FROM product_options po
      USING products p
      WHERE po.id = $1
        AND po.product_id = $2
        AND p.id = po.product_id
        AND p.loja_id = $3
      RETURNING po.*
      `,
      [optionId, productId, lojaId]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Opção não encontrada' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('Erro ao remover opção:', err);
    return res.status(500).json({ error: 'Erro interno ao remover opção' });
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
      DELETE FROM product_option_items
      WHERE id = $1
        AND option_id = $2
        AND EXISTS (
          SELECT 1
          FROM product_options po
          JOIN products p ON p.id = po.product_id
          WHERE po.id = $2
            AND p.loja_id = $3
        )
      RETURNING *
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

/**
 * ============================
 * GRUPOS DE OPÇÕES (ASSOCIAÇÃO EM LOTE)
 * ============================
 */

async function bulkAttachOptionGroups(req, res) {
  const lojaId = req.loja.id;
  const { product_ids: productIds, option_group_id: optionGroupId } = req.body;

  if (!optionGroupId || !Array.isArray(productIds) || productIds.length === 0) {
    return res.status(400).json({
      error: 'option_group_id e product_ids são obrigatórios'
    });
  }

  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];

  if (uniqueProductIds.length === 0) {
    return res.status(400).json({ error: 'product_ids inválido' });
  }

  try {
    await db.query('BEGIN');

    const optionGroupCheck = await db.query(
      `
      SELECT id
      FROM option_groups
      WHERE id = $1
        AND loja_id = $2
      `,
      [optionGroupId, lojaId]
    );

    if (!optionGroupCheck.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Grupo de opções não encontrado' });
    }

    const productPlaceholders = uniqueProductIds
      .map((_, index) => `$${index + 1}`)
      .join(',');
    const productParams = [...uniqueProductIds, lojaId];
    const productQuery = `
      SELECT id
      FROM products
      WHERE id IN (${productPlaceholders})
        AND loja_id = $${uniqueProductIds.length + 1}
    `;
    const productRes = await db.query(productQuery, productParams);
    const validProductIds = productRes.rows.map(row => row.id);

    if (!validProductIds.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Produtos não encontrados' });
    }

    const associationPlaceholders = validProductIds
      .map((_, index) => `$${index + 2}`)
      .join(',');
    const existingRes = await db.query(
      `
      SELECT product_id
      FROM product_option_groups
      WHERE option_group_id = $1
        AND product_id IN (${associationPlaceholders})
      `,
      [optionGroupId, ...validProductIds]
    );

    const alreadyAssociated = existingRes.rows.map(row => row.product_id);
    const alreadyAssociatedSet = new Set(alreadyAssociated);
    const toAttach = validProductIds.filter(
      productId => !alreadyAssociatedSet.has(productId)
    );

    let updatedCount = 0;

    if (toAttach.length) {
      const values = toAttach
        .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
        .join(',');
      const insertParams = [];
      toAttach.forEach(productId => {
        insertParams.push(productId, optionGroupId);
      });

      const insertRes = await db.query(
        `
        INSERT INTO product_option_groups (product_id, option_group_id)
        VALUES ${values}
        ON CONFLICT (product_id, option_group_id) DO NOTHING
        `,
        insertParams
      );

      updatedCount = insertRes.rowCount || 0;
    }

    await db.query('COMMIT');

    return res.json({
      updated_count: updatedCount,
      already_associated: alreadyAssociated
    });
  } catch (err) {
    console.error('Erro ao associar grupos de opções em lote:', err);
    await db.query('ROLLBACK');
    return res
      .status(500)
      .json({ error: 'Erro interno ao associar grupos de opções' });
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
  updateProductOption,
  deleteProductOption,
  listProductOptionItems,
  createProductOptionItem,
  updateProductOptionItem,
  deleteProductOptionItem,
  bulkAttachOptionGroups
};
