const db = require('../config/db');
const PIX_NOT_CONFIGURED_MESSAGE = 'A loja não possui Mercado Pago Access Token configurado.';
const PIX_DEPRECATED_MESSAGE = 'Este endpoint foi descontinuado. Use o checkout PIX oficial via criação de pedido.';

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}

async function generatePublicPix({ publicKey, amount, description }) {
  const safeAmount = parseAmount(amount);
  if (safeAmount === null) {
    return {
      ok: false,
      status: 400,
      error: 'Informe um valor válido maior que zero.'
    };
  }

  const lojaRes = await db.query(
    `
    SELECT
      l.id,
      l.is_active,
      ss.mercado_pago_access_token
    FROM lojas l
    LEFT JOIN store_settings ss ON ss.loja_id = l.id
    WHERE l.public_key = $1
    LIMIT 1
    `,
    [publicKey]
  );

  if (!lojaRes.rows.length) {
    return {
      ok: false,
      status: 404,
      error: 'Loja não encontrada.'
    };
  }

  const loja = lojaRes.rows[0];
  if (!loja.is_active) {
    return {
      ok: false,
      status: 403,
      error: 'Loja inativa.'
    };
  }

  const mercadoPagoAccessToken = String(loja.mercado_pago_access_token || '').trim();
  if (!mercadoPagoAccessToken) {
    return {
      ok: false,
      status: 400,
      error: PIX_NOT_CONFIGURED_MESSAGE
    };
  }

  return {
    ok: false,
    status: 410,
    error: PIX_DEPRECATED_MESSAGE,
    hint: {
      amount: safeAmount,
      description: description || null
    }
  };
}

module.exports = {
  generatePublicPix,
  PIX_NOT_CONFIGURED_MESSAGE,
  PIX_DEPRECATED_MESSAGE
};
