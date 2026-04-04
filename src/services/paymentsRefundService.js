const crypto = require('crypto');
const db = require('../config/db');
const { requestPaymentRefund } = require('./paymentsApiService');

const REFUND_STATUS = {
  PENDING_DISPATCH: 'pending_dispatch',
  IN_PROGRESS: 'in_progress',
  SUCCEEDED: 'succeeded',
  IDEMPOTENT_SUCCEEDED: 'idempotent_succeeded',
  FAILED: 'failed',
  REJECTED: 'rejected'
};

const REFUND_REASONS = {
  STORE_CLOSED_BEFORE_CONVERSION: 'store_closed_before_conversion',
  ORDER_REJECTED_AFTER_PAYMENT: 'order_rejected_after_payment',
  OPERATIONAL_BLOCK_AFTER_PAYMENT: 'operational_block_after_payment'
};

const ALLOWED_REASONS = new Set(Object.values(REFUND_REASONS));

function buildIdempotencyKey({ lojaId, paymentId, correlationId, sessionId, orderId, triggerReason }) {
  const payload = [
    String(lojaId || ''),
    String(paymentId || ''),
    String(correlationId || ''),
    String(sessionId || ''),
    String(orderId || ''),
    String(triggerReason || '')
  ].join('|');

  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function getExistingByIdempotencyKey({ tx = db, idempotencyKey }) {
  const existingRes = await tx.query(
    `
    SELECT *
    FROM payment_refund_requests
    WHERE idempotency_key = $1
    LIMIT 1
    `,
    [idempotencyKey]
  );

  return existingRes.rows[0] || null;
}

function buildRejectedResult(reason, details = null) {
  return {
    ok: false,
    dispatched: false,
    status: REFUND_STATUS.REJECTED,
    reason,
    details
  };
}

function parseProviderStatus(payload) {
  const status = String(payload?.status || '').toLowerCase();
  if (status.includes('idempot')) {
    return REFUND_STATUS.IDEMPOTENT_SUCCEEDED;
  }
  return REFUND_STATUS.SUCCEEDED;
}

async function requestAutomaticRefund({
  lojaId,
  paymentId,
  correlationId = null,
  sessionId = null,
  orderId = null,
  triggerReason,
  paymentStatus,
  paymentSnapshotLojaId = null,
  expectedCorrelationId = null,
  observedCorrelationId = null
}) {
  if (!ALLOWED_REASONS.has(triggerReason)) {
    return buildRejectedResult('invalid_reason', { triggerReason });
  }

  if (!lojaId || !paymentId) {
    return buildRejectedResult('missing_identifiers', { lojaId, paymentId });
  }

  if (String(paymentStatus || '').toLowerCase() !== 'approved') {
    return buildRejectedResult('payment_not_approved', { paymentStatus });
  }

  if (paymentSnapshotLojaId && String(paymentSnapshotLojaId) !== String(lojaId)) {
    return buildRejectedResult('tenant_mismatch', {
      paymentSnapshotLojaId,
      lojaId
    });
  }

  if (expectedCorrelationId && observedCorrelationId && String(expectedCorrelationId) !== String(observedCorrelationId)) {
    return buildRejectedResult('correlation_mismatch', {
      expectedCorrelationId,
      observedCorrelationId
    });
  }

  const idempotencyKey = buildIdempotencyKey({
    lojaId,
    paymentId,
    correlationId,
    sessionId,
    orderId,
    triggerReason
  });

  const requestId = crypto.randomUUID();

  const reservation = await db.withTransaction(async tx => {
    const existing = await getExistingByIdempotencyKey({ tx, idempotencyKey });
    if (existing) {
      return {
        alreadyExists: true,
        request: existing
      };
    }

    await tx.query(
      `
      INSERT INTO payment_refund_requests (
        id,
        loja_id,
        payment_id,
        correlation_id,
        session_id,
        order_id,
        trigger_reason,
        status,
        provider_response_payload,
        idempotency_key
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        requestId,
        lojaId,
        paymentId,
        correlationId || null,
        sessionId || null,
        orderId || null,
        triggerReason,
        REFUND_STATUS.PENDING_DISPATCH,
        JSON.stringify({
          source: 'backend-principal',
          created_at: new Date().toISOString()
        }),
        idempotencyKey
      ]
    );

    return {
      alreadyExists: false,
      request: {
        id: requestId,
        idempotency_key: idempotencyKey
      }
    };
  });

  if (reservation.alreadyExists) {
    const existingStatus = reservation.request.status;
    const isExistingSuccess = [REFUND_STATUS.SUCCEEDED, REFUND_STATUS.IDEMPOTENT_SUCCEEDED].includes(existingStatus);

    return {
      ok: true,
      dispatched: false,
      status: isExistingSuccess ? existingStatus : existingStatus,
      idempotent: true,
      requestId: reservation.request.id
    };
  }

  try {
    await db.query(
      `
      UPDATE payment_refund_requests
      SET status = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      `,
      [REFUND_STATUS.IN_PROGRESS, requestId]
    );

    const providerPayload = await requestPaymentRefund({
      paymentId,
      lojaId,
      correlationId,
      reason: triggerReason
    });

    const resolvedStatus = parseProviderStatus(providerPayload);

    await db.query(
      `
      UPDATE payment_refund_requests
      SET status = $1,
          provider_response_payload = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      `,
      [resolvedStatus, JSON.stringify(providerPayload || {}), requestId]
    );

    return {
      ok: true,
      dispatched: true,
      status: resolvedStatus,
      idempotent: resolvedStatus === REFUND_STATUS.IDEMPOTENT_SUCCEEDED,
      requestId
    };
  } catch (error) {
    await db.query(
      `
      UPDATE payment_refund_requests
      SET status = $1,
          provider_response_payload = $2,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      `,
      [
        REFUND_STATUS.FAILED,
        JSON.stringify({
          error: error.message,
          provider_status: error.providerStatus || null,
          status_code: error.statusCode || null
        }),
        requestId
      ]
    );

    return {
      ok: false,
      dispatched: true,
      status: REFUND_STATUS.FAILED,
      requestId,
      error: error.message
    };
  }
}

module.exports = {
  REFUND_REASONS,
  REFUND_STATUS,
  requestAutomaticRefund
};
