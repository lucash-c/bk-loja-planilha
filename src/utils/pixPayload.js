const DEFAULT_MCC = '0000';
const DEFAULT_CURRENCY = '986';
const DEFAULT_COUNTRY = 'BR';
const DEFAULT_TXID = 'SEMID';

function normalizeMerchantText(value, maxLength) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)
    .toUpperCase();
}

function formatPixAmount(amount) {
  return Number(amount).toFixed(2);
}

function emv(id, value) {
  const stringValue = String(value || '');
  const length = String(stringValue.length).padStart(2, '0');
  return `${id}${length}${stringValue}`;
}

function crc16(payload) {
  let crc = 0xffff;

  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;

    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload({
  pixKey,
  amount,
  merchantName,
  merchantCity,
  description,
  txid = DEFAULT_TXID
}) {
  const safePixKey = String(pixKey || '').trim();
  if (!safePixKey) {
    throw new Error('Chave PIX inválida para geração do payload.');
  }

  const safeMerchantName = normalizeMerchantText(merchantName, 25) || 'LOJA ONLINE';
  const safeMerchantCity = normalizeMerchantText(merchantCity, 15) || 'SAO PAULO';
  const safeDescription = normalizeMerchantText(description, 72);
  const safeTxid = normalizeMerchantText(txid, 25) || DEFAULT_TXID;

  const merchantAccountInfo = [
    emv('00', 'br.gov.bcb.pix'),
    emv('01', safePixKey),
    safeDescription ? emv('02', safeDescription) : ''
  ].join('');

  const additionalDataField = emv('05', safeTxid);

  const payloadWithoutCrc = [
    emv('00', '01'),
    emv('26', merchantAccountInfo),
    emv('52', DEFAULT_MCC),
    emv('53', DEFAULT_CURRENCY),
    emv('54', formatPixAmount(amount)),
    emv('58', DEFAULT_COUNTRY),
    emv('59', safeMerchantName),
    emv('60', safeMerchantCity),
    emv('62', additionalDataField),
    '6304'
  ].join('');

  const checksum = crc16(payloadWithoutCrc);
  return `${payloadWithoutCrc}${checksum}`;
}

module.exports = {
  buildPixPayload
};
