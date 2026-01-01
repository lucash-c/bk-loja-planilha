const db = require('../config/db');

/**
 * GET PUBLIC MENU
 * Retorna cardápio público da loja
 * Resolve loja pela public_key
 */
async function getPublicMenu(req, res, next) {
  try {
    const { public_key } = req.params;

    // 1️⃣ resolve loja
    const lojaRes = await db.query(
      `
      SELECT id, name, whatsapp
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

    // 2️⃣ produtos ativos
    const productsRes = await db.query(
      `
      SELECT *
      FROM products
      WHERE loja_id = $1
        AND is_active = TRUE
      ORDER BY created_at ASC
      `,
      [loja.id]
    );

    const products = [];

    for (const product of productsRes.rows) {
      // 3️⃣ opções do produto
      const optionsRes = await db.query(
        `
        SELECT *
        FROM product_options
        WHERE product_id = $1
        ORDER BY created_at ASC
        `,
        [product.id]
      );

      const options = [];

      for (const option of optionsRes.rows) {
        // 4️⃣ itens da opção
        const itemsRes = await db.query(
          `
          SELECT *
          FROM product_option_items
          WHERE option_id = $1
            AND is_active = TRUE
          ORDER BY name ASC
          `,
          [option.id]
        );

        options.push({
          ...option,
          items: itemsRes.rows
        });
      }

      products.push({
        ...product,
        options
      });
    }

    res.json({
      loja,
      products
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPublicMenu
};
