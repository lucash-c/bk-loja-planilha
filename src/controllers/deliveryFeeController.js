const db = require('../config/db');

/**
 * ============================
 * LISTAR FRETES DA LOJA
 * ============================
 */
async function listDeliveryFees(req, res, next) {
  try {
    const lojaId = req.loja.id;

    const { rows } = await db.query(
      `
      SELECT *
      FROM store_delivery_fees
      WHERE loja_id = $1
      ORDER BY distance_km ASC
      `,
      [lojaId]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
}

/**
 * ============================
 * CRIAR / ATUALIZAR FAIXA DE FRETE
 * (upsert por distância)
 * ============================
 */
async function upsertDeliveryFee(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const { distance_km, fee, estimated_time_minutes } = req.body;

    if (distance_km === undefined || fee === undefined) {
      return res.status(400).json({
        error: 'distance_km e fee são obrigatórios'
      });
    }

    if (distance_km < 0 || fee < 0) {
      return res.status(400).json({
        error: 'Valores não podem ser negativos'
      });
    }

    const { rows } = await db.query(
      `
      INSERT INTO store_delivery_fees (
        loja_id,
        distance_km,
        fee,
        estimated_time_minutes
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (loja_id, distance_km)
      DO UPDATE SET
        fee = EXCLUDED.fee,
        estimated_time_minutes = EXCLUDED.estimated_time_minutes
      RETURNING *
      `,
      [
        lojaId,
        Number(distance_km),
        Number(fee),
        estimated_time_minutes !== undefined
          ? Number(estimated_time_minutes)
          : null
      ]
    );

    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

/**
 * ============================
 * REMOVER FAIXA DE FRETE
 * ============================
 */
async function deleteDeliveryFee(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const { id } = req.params;

    const { rowCount } = await db.query(
      `
      DELETE FROM store_delivery_fees
      WHERE id = $1
        AND loja_id = $2
      `,
      [id, lojaId]
    );

    if (!rowCount) {
      return res.status(404).json({
        error: 'Faixa de frete não encontrada'
      });
    }

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDeliveryFees,
  upsertDeliveryFee,
  deleteDeliveryFee
};
