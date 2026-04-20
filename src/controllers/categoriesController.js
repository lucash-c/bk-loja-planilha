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
    return { lojaId: req.loja.id, isAuthenticated: true };
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

  return { lojaId: lojaRes.rows[0].id, isAuthenticated: false };
}

async function getCategoryById(id, lojaId) {
  const categoryRes = await db.query(
    `
    SELECT *
    FROM categories
    WHERE id = $1
      AND loja_id = $2
    `,
    [id, lojaId]
  );

  return categoryRes.rows[0] || null;
}

async function listCategories(req, res) {
  try {
    const { lojaId, isAuthenticated, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { active } = req.query;
    const params = [lojaId];
    let categoryFilter = '';

    if (!isAuthenticated || active === 'true') {
      categoryFilter = ' AND c.is_active = TRUE';
    }
    if (isAuthenticated && active === 'false') {
      categoryFilter = ' AND c.is_active = FALSE';
    }

    const { rows } = await db.query(
      `
      SELECT
        c.id,
        c.name,
        c.slug,
        c.image_url,
        c.is_active,
        c.created_at,
        COUNT(p.id) AS product_count,
        MAX(p.created_at) AS latest_product_created_at
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
        AND p.is_active = TRUE
        AND p.is_visible = TRUE
        AND p.loja_id = $1
      WHERE c.loja_id = $1
        ${categoryFilter}
      GROUP BY c.id
      ORDER BY c.name ASC
      `,
      params
    );

    const categories = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      image_url: row.image_url,
      is_active: Boolean(row.is_active),
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
    const { lojaId, isAuthenticated, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { id } = req.params;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const cursorData = req.query.cursor ? decodeCursor(req.query.cursor) : null;
    const { active, visible } = req.query;

    const categoryRes = await db.query(
      `
      SELECT id, is_active
      FROM categories
      WHERE id = $1
        AND loja_id = $2
      `,
      [id, lojaId]
    );

    if (!categoryRes.rows.length) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    if (!isAuthenticated && !categoryRes.rows[0].is_active) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    const params = [id, lojaId];
    let paramIndex = params.length + 1;

    let filters = '';
    if (!isAuthenticated || active === 'true') {
      filters += ' AND is_active = TRUE';
    }
    if (isAuthenticated && active === 'false') {
      filters += ' AND is_active = FALSE';
    }
    if (!isAuthenticated || visible === 'true') {
      filters += ' AND is_visible = TRUE';
    }
    if (isAuthenticated && visible === 'false') {
      filters += ' AND is_visible = FALSE';
    }

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
        ${filters}
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
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { name, slug, image_url, is_active = true } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'name é obrigatório' });
    }

    const finalSlug = slugify(slug || name);

    if (!finalSlug) {
      return res.status(400).json({ error: 'slug inválido' });
    }

    const { rows } = await db.query(
      `
      INSERT INTO categories (loja_id, name, slug, image_url, is_active)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [lojaId, name, finalSlug, image_url || null, is_active]
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

async function updateCategory(req, res) {
  try {
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { id } = req.params;
    const { name, slug, image_url, is_active } = req.body;

    const existing = await getCategoryById(id, lojaId);
    if (!existing) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    const nextSlug = slug === undefined ? existing.slug : slugify(slug || name || existing.name);
    if (!nextSlug) {
      return res.status(400).json({ error: 'slug inválido' });
    }

    await db.query(
      `
      UPDATE categories
      SET
        name = COALESCE($1, name),
        slug = $2,
        image_url = COALESCE($3, image_url),
        is_active = COALESCE($4, is_active)
      WHERE id = $5
        AND loja_id = $6
      `,
      [name, nextSlug, image_url, is_active, id, lojaId]
    );

    const updated = await getCategoryById(id, lojaId);
    return res.json(updated);
  } catch (err) {
    if (err && err.code === '23505') {
      return res.status(409).json({ error: 'slug já está em uso' });
    }
    console.error('Erro ao atualizar categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao atualizar categoria' });
  }
}

async function deactivateCategory(req, res) {
  try {
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { id } = req.params;
    const category = await getCategoryById(id, lojaId);

    if (!category) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    await db.withTransaction(async (tx) => {
      await tx.query(
        `
        UPDATE categories
        SET is_active = FALSE
        WHERE id = $1
          AND loja_id = $2
        `,
        [id, lojaId]
      );

      await tx.query(
        `
        UPDATE products
        SET is_active = FALSE
        WHERE category_id = $1
          AND loja_id = $2
        `,
        [id, lojaId]
      );
    });

    const updated = await getCategoryById(id, lojaId);
    return res.json(updated);
  } catch (err) {
    console.error('Erro ao desativar categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao desativar categoria' });
  }
}

async function activateCategory(req, res) {
  try {
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { id } = req.params;
    const updateRes = await db.query(
      `
      UPDATE categories
      SET is_active = TRUE
      WHERE id = $1
        AND loja_id = $2
      `,
      [id, lojaId]
    );

    if (!updateRes.rowCount) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    // Estratégia intencional: reativa somente a categoria.
    // Produtos permanecem no estado atual para evitar reativação indevida em lote.
    const updated = await getCategoryById(id, lojaId);
    return res.json(updated);
  } catch (err) {
    console.error('Erro ao ativar categoria:', err);
    return res.status(500).json({ error: 'Erro interno ao ativar categoria' });
  }
}

async function hardDeleteCategory(req, res) {
  try {
    const { lojaId, error, status } = await resolveLojaId(req);

    if (error) {
      return res.status(status || 400).json({ error });
    }

    const { id } = req.params;
    const forceCascade = String(req.query.force_cascade || '').toLowerCase() === 'true';

    const category = await getCategoryById(id, lojaId);
    if (!category) {
      return res.status(404).json({ error: 'Categoria não encontrada' });
    }

    const productsRes = await db.query(
      `
      SELECT COUNT(*) AS total
      FROM products
      WHERE category_id = $1
        AND loja_id = $2
      `,
      [id, lojaId]
    );

    const totalProducts = Number(productsRes.rows[0]?.total || 0);

    if (totalProducts > 0 && !forceCascade) {
      return res.status(409).json({
        error: 'Categoria possui produtos vinculados. Para exclusão permanente em cascata, envie force_cascade=true.',
        linked_products: totalProducts
      });
    }

    await db.withTransaction(async (tx) => {
      if (forceCascade) {
        await tx.query(
          `
          DELETE FROM products
          WHERE category_id = $1
            AND loja_id = $2
          `,
          [id, lojaId]
        );
      }

      await tx.query(
        `
        DELETE FROM categories
        WHERE id = $1
          AND loja_id = $2
        `,
        [id, lojaId]
      );
    });

    return res.status(204).send();
  } catch (err) {
    console.error('Erro ao excluir categoria permanentemente:', err);
    return res.status(500).json({ error: 'Erro interno ao excluir categoria permanentemente' });
  }
}

// Compatibilidade: DELETE /categories/:id agora usa política profissional de hard delete explícito.
const deleteCategory = hardDeleteCategory;

module.exports = {
  listCategories,
  listCategoryProducts,
  createCategory,
  updateCategory,
  deactivateCategory,
  activateCategory,
  hardDeleteCategory,
  deleteCategory
};
