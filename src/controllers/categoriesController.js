const crypto = require('crypto');
const db = require('../config/db');

function slugify(value) {
  return value
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function encodeCursor(row) {
  return Buffer.from(`${row.created_at}|${row.id}`).toString('base64');
}

function decodeCursor(cursor) {
  try {
    const decoded = Buffer.from(cursor, 'base64').toString('utf8');
    const [createdAt, id] = decoded.split('|');
    if (!createdAt || !id) {
      return null;
    }
    return { createdAt, id };
  } catch (err) {
    return null;
  }
}

async function resolveLojaId(req) {
  if (req.loja && req.loja.id) {
    return { lojaId: req.loja.id };
  }

  if (!req.query.public_key) {
    return {
      error: 'public_key é obrigatório quando não autenticado',
      status: 400
    };
  }

  const lojaRes = await db.query(
    `
    SELECT id
    FROM lojas
    WHERE public_key = $1
      AND is_active = TRUE
    `,
    [req.query.public_key]
  );

  if (!lojaRes.rows.length) {
    return { error: 'Loja não encontrada', status: 404 };
  }

  return { lojaId: lojaRes.rows[0].id };
}

async function listCategories(req, res) {
  try {
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { rows } = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.image_url,
        c.created_at,
        COUNT(p.id) AS product_count,
        MAX(p.created_at) AS latest_product_created_at
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
        AND p.is_active = TRUE
        AND p.is_visible = TRUE
        AND p.loja_id = $1
      GROUP BY c.id
      ORDER BY c.name ASC
      `,
      [lojaId]
    );

    const categories = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      image_url: row.image_url,
      product_count: Number(row.product_count || 0)
    }));

    const lastModified = rows
      .map((row) => [row.created_at, row.latest_product_created_at])
      .flat()
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .sort((a, b) => b - a)[0];

    const etag = crypto
      .createHash('sha256')
      .update(JSON.stringify(categories))
      .digest('hex');

    res.set('Cache-Control', 'public, max-age=60');
    res.set('ETag', etag);
    if (lastModified) {
      res.set('Last-Modified', new Date(lastModified).toUTCString());
    }

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    return res.json(categories);
  } catch (err) {
    console.error('Erro ao listar categorias:', err);
    return res.status(500).json({ error: 'Erro interno ao listar categorias' });
  }
}

async function listCategoryProducts(req, res) {
  try {
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { id } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const cursorData = req.query.cursor ? decodeCursor(req.query.cursor) : null;

    const params = [id, lojaId];
    let paramIndex = params.length + 1;

    let cursorClause = '';
    if (cursorData) {
      cursorClause = ` AND (created_at < $${paramIndex} OR (created_at = $${
        paramIndex
      } AND id < $${paramIndex + 1}))`;
      params.push(cursorData.createdAt, cursorData.id);
      paramIndex += 2;
    }

    const { rows } = await db.query(
      `
      SELECT *
      FROM products
      WHERE category_id = $1
        AND loja_id = $2
        AND is_active = TRUE
        AND is_visible = TRUE
        ${cursorClause}
      ORDER BY created_at DESC, id DESC
      LIMIT $${paramIndex}
      `,
      [...params, limit + 1]
    );

    let nextCursor;
    if (rows.length > limit) {
      const nextRow = rows[limit - 1];
      nextCursor = encodeCursor(nextRow);
      rows.length = limit;
    }

    if (nextCursor) {
      res.set('X-Next-Cursor', nextCursor);
    }

    return res.json(rows);
  } catch (err) {
    console.error('Erro ao listar produtos por categoria:', err);
    return res
      .status(500)
      .json({ error: 'Erro interno ao listar produtos por categoria' });
  }
}

async function createCategory(req, res) {
  try {
    const { name, slug, image_url } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    const finalSlug = slugify(slug || name);

    if (!finalSlug) {
      return res.status(400).json({ error: 'slug inválido' });
    }

    const { rows } = await db.query(
      `
      INSERT INTO categories (name, slug, image_url)
      VALUES ($1, $2, $3)
      RETURNING *
      `,
      [name, finalSlug, image_url || null]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'slug já está em uso' });
    }
    console.error('Erro ao criar categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao criar categoria' });
  }
}

async function deleteCategory(req, res) {
  try {
    const { id } = req.params;

    const categoryRes = await db.query(
      `
      SELECT *
      FROM categories
      WHERE id = $1
      `,
      [id]
    );

    if (!categoryRes.rows.length) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    const deleteProductsRes = await db.query(
      `
      DELETE FROM products
      WHERE category_id = $1
      `,
      [id]
    );

    await db.query(
      `
      DELETE FROM categories
      WHERE id = $1
      `,
      [id]
    );

    return res.json({
      category: categoryRes.rows[0],
      deleted_products: deleteProductsRes.rowCount || 0
    });
  } catch (err) {
    console.error('Erro ao excluir categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir categoria' });
  }
}

module.exports = {
  listCategories,
  listCategoryProducts,
  createCategory,
  deleteCategory
};
