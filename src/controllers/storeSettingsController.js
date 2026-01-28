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
    const {
      pix_key,
      pix_qr_image,
      open_time,
      close_time,
      is_open
    } = req.body;

    const result = await db.query(
      `
      INSERT INTO store_settings (
        loja_id,
        pix_key,
        pix_qr_image,
        open_time,
        close_time,
        is_open
      )
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (loja_id)
      DO UPDATE SET
        pix_key      = EXCLUDED.pix_key,
        pix_qr_image = EXCLUDED.pix_qr_image,
        open_time    = EXCLUDED.open_time,
        close_time   = EXCLUDED.close_time,
        is_open      = EXCLUDED.is_open,
        updated_at   = NOW()
      RETURNING *
      `,
      [
        lojaId,
        pix_key || null,
        pix_qr_image || null,
        open_time || null,
        close_time || null,
        is_open ?? true
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
