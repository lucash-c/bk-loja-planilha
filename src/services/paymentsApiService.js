function getPaymentsApiBaseUrl() {
  const baseUrl = String(process.env.PAYMENTS_API_BASE_URL || '').trim();
  if (!baseUrl) {
    const err = new Error('PAYMENTS_API_BASE_URL não configurada para fluxo PIX.');
    err.statusCode = 500;
    throw err;
  }

  return baseUrl.replace(/\/$/, '');
}

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(options?.headers || {})
    }
  });

  const rawText = await response.text();
  let payload = null;

  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch (_) {
    payload = null;
  }

  if (!response.ok) {
    const error = new Error((payload && payload.error) || `Falha na chamada da API de pagamento (${response.status})`);
    error.statusCode = 502;
    error.providerStatus = response.status;
    throw error;
  }

  return payload;
}

async function createPixPaymentIntent({ lojaId, publicKey, correlationId, amount, orderPayload, mercadoPagoAccessToken }) {
  const baseUrl = getPaymentsApiBaseUrl();
  return requestJson(`${baseUrl}/api/payments/pix/intents`, {
    method: 'POST',
    body: JSON.stringify({
      loja_id: lojaId,
      public_key: publicKey,
      correlation_id: correlationId,
      amount,
      payment_method: 'pix',
      order_payload: orderPayload,
      mercado_pago_access_token: mercadoPagoAccessToken
    })
  });
}

async function fetchPaymentStatus({ paymentId, lojaId, correlationId }) {
  const baseUrl = getPaymentsApiBaseUrl();
  const query = new URLSearchParams();
  query.set('loja_id', lojaId);
  if (correlationId) query.set('correlation_id', correlationId);

  return requestJson(`${baseUrl}/api/payments/${encodeURIComponent(paymentId)}?${query.toString()}`, {
    method: 'GET'
  });
}


async function requestPaymentRefund({ paymentId, lojaId, correlationId = null, reason }) {
  const baseUrl = getPaymentsApiBaseUrl();
  return requestJson(`${baseUrl}/api/payments/${encodeURIComponent(paymentId)}/refund`, {
    method: 'POST',
    body: JSON.stringify({
      loja_id: lojaId,
      correlation_id: correlationId,
      reason
    })
  });
}

module.exports = {
  getPaymentsApiBaseUrl,
  createPixPaymentIntent,
  fetchPaymentStatus,
  requestPaymentRefund
};
