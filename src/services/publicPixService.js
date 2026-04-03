const db = require('../config/db');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { buildPixPayload } = require('../utils/pixPayload');

const PIX_NOT_CONFIGURED_MESSAGE = 'A loja não possui chave PIX configurada.';

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}

function generateTxid() {
  const timestampBase36 = Date.now().toString(36).toUpperCase();
  const randomBase36 = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${timestampBase36}${randomBase36}`.replace(/[^A-Z0-9]/g, '').slice(0, 25) || 'SEMID';
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
      l.name,
      l.cidade,
      l.is_active,
      ss.pix_key
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

  const pixKey = String(loja.pix_key || '').trim();
  if (!pixKey) {
    return {
      ok: false,
      status: 400,
      error: PIX_NOT_CONFIGURED_MESSAGE
    };
  }

  const txid = generateTxid();
  const qrCodeText = buildPixPayload({
    pixKey,
    amount: safeAmount,
    merchantName: loja.name,
    merchantCity: loja.cidade,
    description,
    txid
  });
  const qrCodeBuffer = await QRCode.toBuffer(qrCodeText, {
    type: 'png',
    width: 280,
    errorCorrectionLevel: 'M',
    margin: 2
  });

  return {
    ok: true,
    status: 200,
    pix: {
      qr_code_text: qrCodeText,
      qr_code_base64: qrCodeBuffer.toString('base64'),
      txid,
      amount: safeAmount,
      description: description || null
    }
  };
}

module.exports = {
  generatePublicPix,
  PIX_NOT_CONFIGURED_MESSAGE
};
