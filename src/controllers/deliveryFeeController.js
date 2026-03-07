const db = require('../config/db');

function parseNonNegativeNumber(value, fieldName, index = null) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      index === null
        ? `${fieldName} deve ser um número válido`
        : `${fieldName} deve ser um número válido (index ${index})`
    );
  }

  if (parsed < 0) {
    throw new Error(
      index === null
        ? 'Valores não podem ser negativos'
        : `Valores não podem ser negativos (index ${index})`
    );
  }

  return parsed;
}

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

    let parsedDistance;
    let parsedFee;

    try {
      parsedDistance = parseNonNegativeNumber(distance_km, 'distance_km');
      parsedFee = parseNonNegativeNumber(fee, 'fee');
    } catch (validationError) {
      return res.status(400).json({ error: validationError.message });
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
        parsedDistance,
        parsedFee,
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

/**
 * ============================
 * CRIAR / ATUALIZAR VÁRIAS FAIXAS
 * (upsert em lote)
 * ============================
 */
async function upsertDeliveryFeesBatch(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'items deve ser um array não vazio'
      });
    }

    const params = [];
    const values = items.map((item, index) => {
      const { distance_km, fee, estimated_time_minutes } = item || {};

      if (distance_km === undefined || fee === undefined) {
        throw new Error(`distance_km e fee são obrigatórios (index ${index})`);
      }

      const parsedDistance = parseNonNegativeNumber(distance_km, 'distance_km', index);
      const parsedFee = parseNonNegativeNumber(fee, 'fee', index);

      const baseIndex = params.length + 1;
      params.push(
        lojaId,
        parsedDistance,
        parsedFee,
        estimated_time_minutes !== undefined
          ? Number(estimated_time_minutes)
          : null
      );

      return `($${baseIndex}, $${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3})`;
    });

    await db.query(
      `
      INSERT INTO store_delivery_fees (
        loja_id,
        distance_km,
        fee,
        estimated_time_minutes
      )
      VALUES ${values.join(', ')}
      ON CONFLICT (loja_id, distance_km)
      DO UPDATE SET
        fee = EXCLUDED.fee,
        estimated_time_minutes = EXCLUDED.estimated_time_minutes
      `,
      params
    );

    const distanceParams = items.map((item) => Number(item.distance_km));
    const selectParams = [lojaId, ...distanceParams];
    const distancePlaceholders = distanceParams
      .map((_, idx) => `$${idx + 2}`)
      .join(', ');

    const { rows } = await db.query(
      `
      SELECT *
      FROM store_delivery_fees
      WHERE loja_id = $1
        AND distance_km IN (${distancePlaceholders})
      ORDER BY distance_km ASC
      `,
      selectParams
    );

    res.json(rows);
  } catch (err) {
    if (err.message?.includes('index') || err.message?.includes('deve ser um número válido')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
}

/**
 * ============================
 * REMOVER VÁRIAS FAIXAS
 * ============================
 */
async function deleteDeliveryFeesBatch(req, res, next) {
  try {
    const lojaId = req.loja.id;
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        error: 'ids deve ser um array não vazio'
      });
    }

    const params = [lojaId, ...ids];
    const placeholders = ids.map((_, idx) => `$${idx + 2}`).join(', ');

    const { rowCount } = await db.query(
      `
      DELETE FROM store_delivery_fees
      WHERE loja_id = $1
        AND id IN (${placeholders})
      `,
      params
    );

    res.json({ deleted: rowCount });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDeliveryFees,
  upsertDeliveryFee,
  deleteDeliveryFee,
  upsertDeliveryFeesBatch,
  deleteDeliveryFeesBatch
};
