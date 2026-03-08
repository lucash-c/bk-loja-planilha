let webpushClient = null;
const db = require('../config/db');

const isPostgres = Boolean(process.env.DATABASE_URL);
const nowExpression = isPostgres ? 'now()' : "datetime('now')";

const metricsByStore = new Map();
let vapidConfigured = false;


function getWebPushClient() {
  if (webpushClient) return webpushClient;

  try {
    // eslint-disable-next-line global-require
    webpushClient = require('web-push');
    return webpushClient;
  } catch (err) {
    console.warn('[push-notification:disabled]', {
      reason: 'web_push_dependency_missing'
    });
    return null;
  }
}

function ensureVapidConfigured() {
  if (vapidConfigured) return;

  const publicKey = process.env.VAPID_PUBLIC_KEY || process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY || process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_SUBJECT || process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.warn('[push-notification:disabled]', {
      reason: 'missing_vapid_environment'
    });
    return;
  }

  const client = getWebPushClient();
  if (!client) return;

  client.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

function sanitizeOrderPayload(order) {
  if (!order?.id) return null;

  return {
    order_id: order.id,
    status: order.status || 'new',
    total: Number(order.total || 0),
    created_at: order.created_at || new Date().toISOString()
  };
}

function recordMetric({ lojaId, status, latencyMs }) {
  if (!lojaId) return;

  const current = metricsByStore.get(lojaId) || {
    sent: 0,
    failed: 0,
    total_latency_ms: 0,
    avg_latency_ms: 0,
    success_rate: 0
  };

  if (status === 'sent') {
    current.sent += 1;
    current.total_latency_ms += Number(latencyMs || 0);
  } else if (status === 'failed') {
    current.failed += 1;
  }

  const total = current.sent + current.failed;
  current.avg_latency_ms = current.sent ? Number((current.total_latency_ms / current.sent).toFixed(2)) : 0;
  current.success_rate = total ? Number(((current.sent / total) * 100).toFixed(2)) : 0;
  metricsByStore.set(lojaId, current);

  console.info('[push-notification:metrics]', {
    loja_id: lojaId,
    sent: current.sent,
    failed: current.failed,
    success_rate: current.success_rate,
    avg_latency_ms: current.avg_latency_ms
  });
}

async function enqueueOrderPushJob({ orderId, lojaId, eventType, payload }) {
  if (!orderId || !lojaId || !eventType || !payload) return;

  try {
    await db.query(
      `
      INSERT INTO order_jobs (
        order_id,
        loja_id,
        job_type,
        payload
      )
      VALUES ($1, $2, $3, $4)
      `,
      [
        orderId,
        lojaId,
        'order_push_notification',
        JSON.stringify({
          order_id: orderId,
          loja_id: lojaId,
          event_type: eventType,
          payload
        })
      ]
    );

    console.info('[push-notification:queued]', {
      loja_id: lojaId,
      order_id: orderId,
      event_type: eventType
    });
  } catch (err) {
    const message = String(err?.message || '');
    if (err?.code === '42P01' || message.includes('no such table: order_jobs')) {
      console.warn('[push-notification:disabled]', {
        reason: 'order_jobs_table_missing'
      });
      return;
    }
    throw err;
  }
}

async function upsertSubscription({ lojaId, userId, endpoint, p256dh, auth }) {
  const existing = await db.query(
    `
    SELECT id
    FROM pdv_push_subscriptions
    WHERE loja_id = $1
      AND endpoint = $2
    LIMIT 1
    `,
    [lojaId, endpoint]
  );

  if (existing.rows.length) {
    const id = existing.rows[0].id;
    await db.query(
      `
      UPDATE pdv_push_subscriptions
      SET user_id = $2,
          p256dh = $3,
          auth = $4,
          enabled = TRUE,
          last_seen_at = ${nowExpression},
          updated_at = ${nowExpression}
      WHERE id = $1
      `,
      [id, userId, p256dh, auth]
    );

    return { id, created: false };
  }

  const inserted = await db.query(
    `
    INSERT INTO pdv_push_subscriptions (
      loja_id,
      user_id,
      endpoint,
      p256dh,
      auth,
      enabled,
      last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, TRUE, ${nowExpression})
    RETURNING id
    `,
    [lojaId, userId, endpoint, p256dh, auth]
  );

  let id = inserted.rows[0]?.id;
  if (!id) {
    const selected = await db.query(
      `
      SELECT id
      FROM pdv_push_subscriptions
      WHERE loja_id = $1
        AND endpoint = $2
      LIMIT 1
      `,
      [lojaId, endpoint]
    );
    id = selected.rows[0]?.id;
  }

  return { id, created: true };
}

async function revokeSubscription({ subscriptionId, lojaId }) {
  const result = await db.query(
    `
    UPDATE pdv_push_subscriptions
    SET enabled = FALSE,
        updated_at = ${nowExpression}
    WHERE id = $1
      AND loja_id = $2
    `,
    [subscriptionId, lojaId]
  );

  return result.rowCount > 0;
}

function parsePayload(payload) {
  if (!payload) return {};
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch (err) {
      return {};
    }
  }
  return payload;
}

async function markDelivery({ orderId, eventType, subscriptionId }) {
  try {
    await db.query(
      `
      INSERT INTO order_push_deliveries (
        order_id,
        event_type,
        subscription_id,
        status
      )
      VALUES ($1, $2, $3, 'sent')
      `,
      [orderId, eventType, subscriptionId]
    );

    return true;
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE') || err.code === '23505') {
      return false;
    }
    throw err;
  }
}

async function processOrderPushJob(job) {
  ensureVapidConfigured();
  if (!vapidConfigured) return;

  const payload = parsePayload(job.payload);
  const sanitizedOrder = payload.payload;
  const orderId = payload.order_id || job.order_id;
  const lojaId = payload.loja_id || job.loja_id;
  const eventType = payload.event_type;

  if (!sanitizedOrder?.order_id || !eventType || !lojaId || !orderId) {
    return;
  }

  const subscriptions = await db.query(
    `
    SELECT id, endpoint, p256dh, auth
    FROM pdv_push_subscriptions
    WHERE loja_id = $1
      AND enabled = TRUE
    `,
    [lojaId]
  );

  let transientFailures = 0;

  for (const subscription of subscriptions.rows) {
    const shouldSend = await markDelivery({
      orderId,
      eventType,
      subscriptionId: subscription.id
    });

    if (!shouldSend) continue;

    const startedAt = Date.now();

    try {
      const client = getWebPushClient();
      if (!client) throw new Error('web_push_dependency_missing');

      await client.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth
          }
        },
        JSON.stringify({
          type: eventType,
          payload: sanitizedOrder
        })
      );

      const latencyMs = Date.now() - startedAt;
      recordMetric({ lojaId, status: 'sent', latencyMs });
      console.info('[push-notification:sent]', {
        loja_id: lojaId,
        order_id: orderId,
        subscription_id: subscription.id,
        event_type: eventType,
        latency_ms: latencyMs
      });
    } catch (err) {
      const statusCode = err?.statusCode || err?.status_code;
      const body = err?.body || err?.message;

      await db.query(
        `
        UPDATE order_push_deliveries
        SET status = 'failed',
            provider_status_code = $4,
            error_message = $5,
            updated_at = ${nowExpression}
        WHERE order_id = $1
          AND event_type = $2
          AND subscription_id = $3
        `,
        [orderId, eventType, subscription.id, statusCode || null, String(body || 'push_failed')]
      );

      if (statusCode === 404 || statusCode === 410) {
        await db.query(
          `
          UPDATE pdv_push_subscriptions
          SET enabled = FALSE,
              updated_at = ${nowExpression}
          WHERE id = $1
          `,
          [subscription.id]
        );

        console.warn('[push-notification:subscription_revoked]', {
          loja_id: lojaId,
          subscription_id: subscription.id,
          provider_status_code: statusCode
        });
      } else {
        transientFailures += 1;
      }

      recordMetric({ lojaId, status: 'failed' });
      console.error('[push-notification:failed]', {
        loja_id: lojaId,
        order_id: orderId,
        subscription_id: subscription.id,
        event_type: eventType,
        provider_status_code: statusCode || null,
        error: String(body || 'push_failed')
      });
    }
  }

  if (transientFailures > 0) {
    throw new Error(`Falha transitória no envio de push (${transientFailures})`);
  }
}

module.exports = {
  sanitizeOrderPayload,
  enqueueOrderPushJob,
  upsertSubscription,
  revokeSubscription,
  processOrderPushJob
};
