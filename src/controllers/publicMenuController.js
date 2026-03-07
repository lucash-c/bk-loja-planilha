const db = require('../config/db');

const OPTIONS_SOURCE_MODE = {
  LEGACY: 'legacy',
  GROUP: 'group',
  HYBRID: 'hybrid'
};

function normalizeOptionKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function getPublicMenuOptionsSource() {
  const configured = String(process.env.PUBLIC_MENU_OPTIONS_SOURCE || OPTIONS_SOURCE_MODE.HYBRID).toLowerCase();
  if (Object.values(OPTIONS_SOURCE_MODE).includes(configured)) {
    return configured;
  }

  return OPTIONS_SOURCE_MODE.HYBRID;
}

function sortOptionsByCreatedAtThenName(options) {
  return [...options].sort((a, b) => {
    const createdAtA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const createdAtB = b.created_at ? new Date(b.created_at).getTime() : 0;

    if (createdAtA !== createdAtB) {
      return createdAtA - createdAtB;
    }

    return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' });
  });
}

function sortItemsByName(items) {
  return [...items].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' })
  );
}

function toCanonicalOption({ id, name, type, required, min_choices, max_choices, items, source, created_at }) {
  return {
    id,
    name,
    type,
    required: Boolean(required),
    min_choices: Number(min_choices ?? 0),
    max_choices: Number(max_choices ?? 1),
    created_at,
    source,
    items: sortItemsByName(
      (items || []).map(item => ({
        id: item.id,
        name: item.name,
        price: Number(item.price ?? 0)
      }))
    )
  };
}

/**
 * Agrega opções públicas de um produto unificando legado e option_groups.
 * Regras:
 * - mode=legacy -> apenas product_options
 * - mode=group -> apenas option_groups associados ao produto
 * - mode=hybrid -> combina ambos e deduplica por slug/nome priorizando group
 */
async function buildPublicProductOptions(productId, lojaId) {
  const sourceMode = getPublicMenuOptionsSource();

  const legacyOptions = [];
  if (sourceMode !== OPTIONS_SOURCE_MODE.GROUP) {
    const legacyOptionsRes = await db.query(
      `
      SELECT
        po.id,
        po.name,
        po.type,
        po.required,
        po.min_choices,
        po.max_choices,
        po.created_at
      FROM product_options po
      WHERE po.product_id = $1
        AND po.is_visible = TRUE
      ORDER BY po.created_at ASC, po.name ASC
      `,
      [productId]
    );

    for (const option of legacyOptionsRes.rows) {
      const itemsRes = await db.query(
        `
        SELECT
          poi.id,
          poi.name,
          poi.price
        FROM product_option_items poi
        WHERE poi.option_id = $1
          AND poi.is_active = TRUE
          AND poi.is_visible = TRUE
        ORDER BY poi.name ASC
        `,
        [option.id]
      );

      legacyOptions.push(
        toCanonicalOption({
          ...option,
          source: OPTIONS_SOURCE_MODE.LEGACY,
          items: itemsRes.rows
        })
      );
    }
  }

  const groupOptions = [];
  if (sourceMode !== OPTIONS_SOURCE_MODE.LEGACY) {
    const optionGroupsRes = await db.query(
      `
      SELECT
        og.id,
        og.name,
        og.type,
        og.required,
        og.min_choices,
        og.max_choices,
        pog.created_at AS relation_created_at,
        og.created_at
      FROM product_option_groups pog
      JOIN option_groups og ON og.id = pog.option_group_id
      WHERE pog.product_id = $1
        AND og.loja_id = $2
        AND og.is_active = TRUE
      ORDER BY pog.created_at ASC, og.name ASC
      `,
      [productId, lojaId]
    );

    for (const group of optionGroupsRes.rows) {
      const itemsRes = await db.query(
        `
        SELECT
          ogi.id,
          ogi.name,
          ogi.price
        FROM option_group_items ogi
        WHERE ogi.option_group_id = $1
          AND ogi.is_active = TRUE
          AND ogi.is_visible = TRUE
        ORDER BY ogi.name ASC
        `,
        [group.id]
      );

      groupOptions.push(
        toCanonicalOption({
          ...group,
          created_at: group.relation_created_at || group.created_at,
          source: OPTIONS_SOURCE_MODE.GROUP,
          items: itemsRes.rows
        })
      );
    }
  }

  if (sourceMode === OPTIONS_SOURCE_MODE.LEGACY) {
    return sortOptionsByCreatedAtThenName(legacyOptions);
  }

  if (sourceMode === OPTIONS_SOURCE_MODE.GROUP) {
    return sortOptionsByCreatedAtThenName(groupOptions);
  }

  const deduped = new Map();

  for (const option of legacyOptions) {
    deduped.set(normalizeOptionKey(option.name), option);
  }

  // prioridade para option_groups em caso de equivalência por nome/slug
  for (const option of groupOptions) {
    deduped.set(normalizeOptionKey(option.name), option);
  }

  return sortOptionsByCreatedAtThenName(Array.from(deduped.values()));
}

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
        l.id,
        l.name,
        l.whatsapp,
        l.logo,
        l.facebook,
        l.instagram,
        l.tiktok,
        l.cep,
        l.rua,
        l.numero,
        l.bairro,
        l.estado,
        l.pais,
        COALESCE(ss.is_open, TRUE) AS is_open
      FROM lojas l
      LEFT JOIN store_settings ss ON ss.loja_id = l.id
      WHERE l.public_key = $1
        AND l.is_active = TRUE
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
      const options = await buildPublicProductOptions(product.id, loja.id);

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

    const paymentMethodsRes = await db.query(
      `
      SELECT
        code,
        label,
        requires_change,
        sort_order
      FROM store_payment_methods
      WHERE loja_id = $1
        AND is_active = TRUE
      ORDER BY sort_order ASC, label ASC
      `,
      [loja.id]
    );

    const includeSourceMetadata = process.env.PUBLIC_MENU_OPTIONS_INCLUDE_SOURCE === 'true';
    const responseProducts = includeSourceMetadata
      ? products
      : products.map(product => ({
          ...product,
          options: product.options.map(({ source, ...option }) => option)
        }));

    res.json({
      loja,
      delivery_fees: deliveryFeesRes.rows,
      payment_methods: paymentMethodsRes.rows,
      products: responseProducts,
      categories: includeCategories
        ? categories.map(category => ({
            ...category,
            products: responseProducts.filter(product => (product.category_id ?? 'uncategorized') === (category.id ?? 'uncategorized'))
          }))
        : []
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  buildPublicProductOptions,
  getPublicMenu
};
