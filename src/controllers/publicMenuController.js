const db = require('../config/db');

/**
 * GET PUBLIC MENU
 * Retorna cardápio público da loja
 * Resolve loja pela public_key
 */
async function getPublicMenu(req, res, next) {
  try {
    const { public_key } = req.params;
    const includeCategories = req.query.group_by !== 'none';

    // 1️⃣ resolve loja (dados públicos)
    const lojaRes = await db.query(
      `
      SELECT
        id,
        name,
        whatsapp,
        logo,
        facebook,
        instagram,
        tiktok,
        cep,
        rua,
        numero,
        bairro,
        estado,
        pais
      FROM lojas
      WHERE public_key = $1
        AND is_active = TRUE
      `,
      [public_key]
    );

    if (!lojaRes.rows.length) {
      return res.status(404).json({ error: 'Loja não encontrada' });
    }

    const loja = lojaRes.rows[0];

    // 2️⃣ produtos ativos e visíveis
    const productsRes = await db.query(
      `
      SELECT
        p.*, 
        c.id AS category_meta_id,
        c.name AS category_meta_name,
        c.slug AS category_meta_slug,
        c.image_url AS category_meta_image_url
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.loja_id = $1
        AND p.is_active = TRUE
        AND p.is_visible = TRUE
      ORDER BY p.created_at ASC
      `,
      [loja.id]
    );

    const products = [];

    for (const product of productsRes.rows) {
      // 3️⃣ opções visíveis do produto
      const optionsRes = await db.query(
        `
        SELECT *
        FROM product_options
        WHERE product_id = $1
          AND is_visible = TRUE
        ORDER BY created_at ASC
        `,
        [product.id]
      );

      const options = [];

      for (const option of optionsRes.rows) {
        // 4️⃣ itens ativos e visíveis da opção
        const itemsRes = await db.query(
          `
          SELECT *
          FROM product_option_items
          WHERE option_id = $1
            AND is_active = TRUE
            AND is_visible = TRUE
          ORDER BY name ASC
          `,
          [option.id]
        );

        options.push({
          ...option,
          items: itemsRes.rows
        });
      }

      const {
        category_meta_id,
        category_meta_name,
        category_meta_slug,
        category_meta_image_url,
        ...productData
      } = product;

      products.push({
        ...productData,
        category: productData.category_id
          ? {
              id: category_meta_id,
              name: category_meta_name,
              slug: category_meta_slug,
              image_url: category_meta_image_url
            }
          : null,
        options
      });
    }

    const categoriesMap = new Map();

    for (const product of products) {
      const categoryKey = product.category_id ?? 'uncategorized';

      if (!categoriesMap.has(categoryKey)) {
        categoriesMap.set(categoryKey, {
          id: product.category?.id ?? null,
          name: product.category?.name ?? 'Sem categoria',
          slug: product.category?.slug ?? null,
          image_url: product.category?.image_url ?? null,
          products: []
        });
      }

      categoriesMap.get(categoryKey).products.push(product);
    }

    const categories = includeCategories ? Array.from(categoriesMap.values()) : [];

    // 5️⃣ faixas de frete públicas da loja
    const deliveryFeesRes = await db.query(
      `
      SELECT
        distance_km,
        fee,
        estimated_time_minutes
      FROM store_delivery_fees
      WHERE loja_id = $1
      ORDER BY distance_km ASC
      `,
      [loja.id]
    );

    res.json({
      loja,
      delivery_fees: deliveryFeesRes.rows,
      products,
      categories
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPublicMenu
};
