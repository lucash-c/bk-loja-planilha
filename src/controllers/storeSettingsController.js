const db = require('../config/db');

/**
 * GET SETTINGS
 * Retorna configurações da loja ativa
 */
async function getSettings(req, res, next) {
  try {
    const lojaId = req.loja.id;

    const result = await db.query(
      `
      SELECT
        mercado_pago_access_token,
        pix_key,
        pix_qr_image,
        open_time,
        close_time,
        is_open
      FROM store_settings
      WHERE loja_id = $1
      `,
      [lojaId]
    );

    if (!result.rows.length) {
      return res.json({
        mercado_pago_access_token: null,
        pix_key: null,
        pix_qr_image: null,
        open_time: null,
        close_time: null,
        is_open: true
      });
    }

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * UPSERT SETTINGS
 * Cria ou atualiza configurações da loja
 */
async function upsertSettings(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const userRole = req.userLoja?.role;

    if (userRole !== 'owner') {
      return res
        .status(403)
        .json({ error: 'Apenas o owner pode alterar as configurações' });
    }
    const { mercado_pago_access_token, pix_qr_image, open_time, close_time, is_open } = req.body;
    const normalizedMercadoPagoAccessToken =
      typeof mercado_pago_access_token === 'string' ? mercado_pago_access_token.trim() : null;
    const normalizedIsOpen = is_open === undefined || is_open === null ? true : Boolean(is_open);

    const result = await db.query(
      `
      INSERT INTO store_settings (
        loja_id,
        mercado_pago_access_token,
        pix_qr_image,
        open_time,
        close_time,
        is_open
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (loja_id)
      DO UPDATE SET
        mercado_pago_access_token = EXCLUDED.mercado_pago_access_token,
        pix_qr_image = EXCLUDED.pix_qr_image,
        open_time    = EXCLUDED.open_time,
        close_time   = EXCLUDED.close_time,
        is_open      = EXCLUDED.is_open,
        updated_at   = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        lojaId,
        normalizedMercadoPagoAccessToken || null,
        pix_qr_image || null,
        open_time || null,
        close_time || null,
        db.supportsForUpdate ? normalizedIsOpen : (normalizedIsOpen ? 1 : 0)
      ]
    );

    res.json({
      ok: true,
      settings: result.rows[0]
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  upsertSettings
};
