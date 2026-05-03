const db = require('../config/db');

function normalizeBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;

  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();

    if (v === 'true' || v === '1' || v === 'sim') return true;
    if (v === 'false' || v === '0' || v === 'nao' || v === 'não') return false;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  return false;
}

function buildStoreOpeningChecklistMissingItems(checklistData) {
  const missing = [];

  if (!checklistData.openTime) {
    missing.push({
      field: 'open_time',
      message: 'Configure o horário de abertura.'
    });
  }

  if (!checklistData.closeTime) {
    missing.push({
      field: 'close_time',
      message: 'Configure o horário de fechamento.'
    });
  }

  if (!checklistData.hasCompleteAddress) {
    missing.push({
      field: 'address',
      message: 'Complete o endereço da loja.'
    });
  }
  if (!checklistData.hasAtLeastOneServiceModeEnabled) {
    missing.push({
      field: 'service_modes',
      message: 'Mantenha pelo menos uma forma de atendimento ativa.'
    });
  }
  if (checklistData.deliveryEnabled && !checklistData.hasDeliveryFeeRange) {
    missing.push({
      field: 'delivery_enabled',
      message: 'Cadastre pelo menos uma faixa de entrega antes de ativar Entrega.'
    });
  }
  if ((checklistData.pickupEnabled || checklistData.dineInEnabled) && !checklistData.hasCompleteAddress) {
    if (checklistData.pickupEnabled) {
      missing.push({
        field: 'pickup_enabled',
        message: 'Complete o endereço da loja antes de ativar Retirada.'
      });
    }
    if (checklistData.dineInEnabled) {
      missing.push({
        field: 'dine_in_enabled',
        message: 'Complete o endereço da loja antes de ativar Comer no local.'
      });
    }
  }

  if (!checklistData.hasActivePaymentMethod) {
    missing.push({
      field: 'payment_methods',
      message: 'Cadastre pelo menos uma forma de pagamento ativa.'
    });
  }

  if (!checklistData.hasSellableProduct) {
    missing.push({
      field: 'products',
      message: 'Cadastre pelo menos um produto ativo e visível.'
    });
  }

  if (checklistData.hasPixActivePaymentMethod && !checklistData.mercadoPagoAccessToken) {
    missing.push({
      field: 'mercado_pago_access_token',
      message: 'Configure o Mercado Pago para aceitar PIX.'
    });
  }

  return missing;
}

async function validateStoreOpeningChecklist({ lojaId, openTime, closeTime, mercadoPagoAccessToken }) {
  const [
    lojaRes,
    activePaymentMethodsRes,
    activePixPaymentMethodsRes,
    sellableProductsRes,
    deliveryFeesRes,
    storeSettingsRes
  ] = await Promise.all([
    db.query(
      `
      SELECT
        cep,
        rua,
        numero,
        bairro,
        estado,
        pais
      FROM lojas
      WHERE id = $1
      LIMIT 1
      `,
      [lojaId]
    ),
    db.query(
      `
      SELECT 1
      FROM store_payment_methods
      WHERE loja_id = $1
        AND is_active = TRUE
      LIMIT 1
      `,
      [lojaId]
    ),
    db.query(
      `
      SELECT 1
      FROM store_payment_methods
      WHERE loja_id = $1
        AND is_active = TRUE
        AND code = 'pix'
      LIMIT 1
      `,
      [lojaId]
    ),
    db.query(
      `
      SELECT 1
      FROM products p
      LEFT JOIN categories c
        ON c.id = p.category_id
       AND c.loja_id = p.loja_id
      WHERE p.loja_id = $1
        AND p.is_active = TRUE
        AND p.is_visible = TRUE
        AND (p.category_id IS NULL OR c.is_active = TRUE)
      LIMIT 1
      `,
      [lojaId]
    ),
    db.query(
      `
      SELECT 1
      FROM store_delivery_fees
      WHERE loja_id = $1
      LIMIT 1
      `,
      [lojaId]
    ),
    db.query(
      `
      SELECT
        COALESCE(delivery_enabled, TRUE) AS delivery_enabled,
        COALESCE(pickup_enabled, TRUE) AS pickup_enabled,
        COALESCE(dine_in_enabled, TRUE) AS dine_in_enabled
      FROM store_settings
      WHERE loja_id = $1
      LIMIT 1
      `,
      [lojaId]
    )
  ]);
  const storeSettings = storeSettingsRes.rows[0] || {};
  const deliveryEnabled = Boolean(storeSettings.delivery_enabled ?? true);
  const pickupEnabled = Boolean(storeSettings.pickup_enabled ?? true);
  const dineInEnabled = Boolean(storeSettings.dine_in_enabled ?? true);

  const loja = lojaRes.rows[0] || {};
  const hasCompleteAddress =
    Boolean(loja.cep?.trim()) &&
    Boolean(loja.rua?.trim()) &&
    Boolean(loja.numero?.trim()) &&
    Boolean(loja.bairro?.trim()) &&
    Boolean(loja.estado?.trim()) &&
    Boolean(loja.pais?.trim());

  return buildStoreOpeningChecklistMissingItems({
    openTime: typeof openTime === 'string' ? openTime.trim() : openTime,
    closeTime: typeof closeTime === 'string' ? closeTime.trim() : closeTime,
    mercadoPagoAccessToken,
    hasCompleteAddress,
    hasActivePaymentMethod: activePaymentMethodsRes.rows.length > 0,
    hasPixActivePaymentMethod: activePixPaymentMethodsRes.rows.length > 0,
    hasSellableProduct: sellableProductsRes.rows.length > 0
    ,hasAtLeastOneServiceModeEnabled: deliveryEnabled || pickupEnabled || dineInEnabled,
    hasDeliveryFeeRange: deliveryFeesRes.rows.length > 0,
    deliveryEnabled,
    pickupEnabled,
    dineInEnabled
  });
}

async function validateStoreServiceModes({ lojaId, deliveryEnabled, pickupEnabled, dineInEnabled }) {
  const missing = [];
  if (!deliveryEnabled && !pickupEnabled && !dineInEnabled) {
    missing.push({ field: 'service_modes', message: 'Mantenha pelo menos uma forma de atendimento ativa.' });
  }
  const [deliveryFeesRes, lojaRes] = await Promise.all([
    deliveryEnabled
      ? db.query('SELECT 1 FROM store_delivery_fees WHERE loja_id = $1 LIMIT 1', [lojaId])
      : Promise.resolve({ rows: [] }),
    (pickupEnabled || dineInEnabled)
      ? db.query('SELECT cep, rua, numero, bairro, estado, pais FROM lojas WHERE id = $1 LIMIT 1', [lojaId])
      : Promise.resolve({ rows: [] })
  ]);
  if (deliveryEnabled && !deliveryFeesRes.rows.length) {
    missing.push({ field: 'delivery_enabled', message: 'Cadastre pelo menos uma faixa de entrega antes de ativar Entrega.' });
  }
  const loja = lojaRes.rows[0] || {};
  const hasCompleteAddress = Boolean(loja.cep?.trim()) && Boolean(loja.rua?.trim()) && Boolean(loja.numero?.trim()) && Boolean(loja.bairro?.trim()) && Boolean(loja.estado?.trim()) && Boolean(loja.pais?.trim());
  if (pickupEnabled && !hasCompleteAddress) missing.push({ field: 'pickup_enabled', message: 'Complete o endereço da loja antes de ativar Retirada.' });
  if (dineInEnabled && !hasCompleteAddress) missing.push({ field: 'dine_in_enabled', message: 'Complete o endereço da loja antes de ativar Comer no local.' });
  return missing;
}

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
        is_open,
        COALESCE(delivery_enabled, TRUE) AS delivery_enabled,
        COALESCE(pickup_enabled, TRUE) AS pickup_enabled,
        COALESCE(dine_in_enabled, TRUE) AS dine_in_enabled
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
        is_open: true,
        delivery_enabled: true,
        pickup_enabled: true,
        dine_in_enabled: true
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
    const { mercado_pago_access_token, pix_qr_image, open_time, close_time, is_open, delivery_enabled, pickup_enabled, dine_in_enabled } = req.body;
    const normalizedMercadoPagoAccessToken =
      typeof mercado_pago_access_token === 'string' ? mercado_pago_access_token.trim() : null;
    const existingRes = await db.query('SELECT * FROM store_settings WHERE loja_id = $1 LIMIT 1', [lojaId]);
    const existing = existingRes.rows[0] || {};
    const nextIsOpen =
      typeof is_open === 'undefined'
        ? Boolean(existing.is_open ?? true)
        : normalizeBoolean(is_open);
    const nextDeliveryEnabled = typeof delivery_enabled === 'undefined' ? Boolean(existing.delivery_enabled ?? true) : normalizeBoolean(delivery_enabled);
    const nextPickupEnabled = typeof pickup_enabled === 'undefined' ? Boolean(existing.pickup_enabled ?? true) : normalizeBoolean(pickup_enabled);
    const nextDineInEnabled = typeof dine_in_enabled === 'undefined' ? Boolean(existing.dine_in_enabled ?? true) : normalizeBoolean(dine_in_enabled);
    const serviceModeMissing = await validateStoreServiceModes({
      lojaId,
      deliveryEnabled: nextDeliveryEnabled,
      pickupEnabled: nextPickupEnabled,
      dineInEnabled: nextDineInEnabled
    });
    if (serviceModeMissing.length > 0) {
      return res.status(400).json({
        error: 'Configuração inválida para tipos de atendimento',
        code: 'STORE_SERVICE_MODES_VALIDATION_FAILED',
        missing: serviceModeMissing
      });
    }

    if (nextIsOpen) {
      const missing = await validateStoreOpeningChecklist({
        lojaId,
        openTime: open_time,
        closeTime: close_time,
        mercadoPagoAccessToken: normalizedMercadoPagoAccessToken
      });

      if (missing.length > 0) {
        return res.status(400).json({
          error: 'Cadastro incompleto para abrir a loja',
          code: 'STORE_OPENING_CHECKLIST_FAILED',
          missing
        });
      }
    }

    const result = await db.query(
      `
      INSERT INTO store_settings (
        loja_id,
        mercado_pago_access_token,
        pix_qr_image,
        open_time,
        close_time,
        is_open,
        last_pdv_heartbeat_at
        ,delivery_enabled
        ,pickup_enabled
        ,dine_in_enabled
      )
      VALUES ($1,$2,$3,$4,$5,$6,CASE WHEN $7 THEN CURRENT_TIMESTAMP ELSE NULL END,$8,$9,$10)
      ON CONFLICT (loja_id)
      DO UPDATE SET
        mercado_pago_access_token = EXCLUDED.mercado_pago_access_token,
        pix_qr_image = EXCLUDED.pix_qr_image,
        open_time    = EXCLUDED.open_time,
        close_time   = EXCLUDED.close_time,
        is_open      = EXCLUDED.is_open,
        last_pdv_heartbeat_at = CASE
          WHEN EXCLUDED.is_open THEN CURRENT_TIMESTAMP
          ELSE store_settings.last_pdv_heartbeat_at
        END,
        delivery_enabled = EXCLUDED.delivery_enabled,
        pickup_enabled = EXCLUDED.pickup_enabled,
        dine_in_enabled = EXCLUDED.dine_in_enabled,
        updated_at   = CURRENT_TIMESTAMP
      RETURNING *
      `,
      [
        lojaId,
        normalizedMercadoPagoAccessToken || null,
        pix_qr_image || null,
        open_time || null,
        close_time || null,
        db.supportsForUpdate ? nextIsOpen : (nextIsOpen ? 1 : 0),
        db.supportsForUpdate ? nextIsOpen : (nextIsOpen ? 1 : 0),
        db.supportsForUpdate ? nextDeliveryEnabled : (nextDeliveryEnabled ? 1 : 0),
        db.supportsForUpdate ? nextPickupEnabled : (nextPickupEnabled ? 1 : 0),
        db.supportsForUpdate ? nextDineInEnabled : (nextDineInEnabled ? 1 : 0)
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

async function heartbeat(req, res, next) {
  try {
    const lojaId = req.loja.id;

    await db.query(
      `
      INSERT INTO store_settings (
        loja_id,
        last_pdv_heartbeat_at
      )
      VALUES ($1, CURRENT_TIMESTAMP)
      ON CONFLICT (loja_id)
      DO UPDATE SET
        last_pdv_heartbeat_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      `,
      [lojaId]
    );

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSettings,
  upsertSettings,
  heartbeat
};
