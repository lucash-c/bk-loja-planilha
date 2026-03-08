const db = require('../config/db');
const { processOrderPushJob } = require('../services/pushNotificationService');

const POLL_INTERVAL_MS = Number(
  process.env.ORDER_JOBS_POLL_INTERVAL_MS || 5000
);
const BATCH_SIZE = Number(process.env.ORDER_JOBS_BATCH_SIZE || 5);
const isPostgres = Boolean(process.env.DATABASE_URL);

const nowExpression = isPostgres ? 'now()' : "datetime('now')";

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

function calculateBackoffMs(attempts) {
  const base = 30000;
  const max = 5 * 60 * 1000;
  return Math.min(max, base * Math.max(1, attempts));
}

// Ações pós-criação de pedido que não precisam ocorrer no request:
// - Envio de WhatsApp
// - Envio de e-mail
// - Integração com ERP
async function sendWhatsAppNotification({ orderId, lojaId }) {
  console.log(
    `[order-jobs] WhatsApp enviado para pedido ${orderId} (loja ${lojaId})`
  );
}

async function sendEmailNotification({ orderId, lojaId }) {
  console.log(
    `[order-jobs] E-mail enviado para pedido ${orderId} (loja ${lojaId})`
  );
}

async function integrateWithErp({ orderId, lojaId }) {
  console.log(
    `[order-jobs] Integração ERP executada para pedido ${orderId} (loja ${lojaId})`
  );
}

async function fetchNextJob() {
  if (isPostgres) {
    const { rows } = await db.query(
      `
      WITH next_job AS (
        SELECT id
        FROM order_jobs
        WHERE status IN ('pending', 'failed')
          AND run_at <= now()
          AND attempts < max_attempts
        ORDER BY run_at ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE order_jobs
      SET status = 'processing',
          locked_at = now(),
          updated_at = now(),
          attempts = attempts + 1
      WHERE id IN (SELECT id FROM next_job)
      RETURNING *
      `
    );

    return rows[0];
  }

  const { rows } = await db.query(
    `
    SELECT *
    FROM order_jobs
    WHERE status IN ('pending', 'failed')
      AND run_at <= ${nowExpression}
      AND attempts < max_attempts
    ORDER BY run_at ASC, created_at ASC
    LIMIT 1
    `
  );

  if (!rows.length) {
    return null;
  }

  const job = rows[0];

  await db.query(
    `
    UPDATE order_jobs
    SET status = 'processing',
        locked_at = ${nowExpression},
        updated_at = ${nowExpression},
        attempts = attempts + 1
    WHERE id = $1
    `,
    [job.id]
  );

  const updated = await db.query('SELECT * FROM order_jobs WHERE id = $1', [
    job.id
  ]);

  return updated.rows[0];
}

async function markAttempt(jobId, attemptNumber, status, errorMessage = null) {
  let sql = `
    UPDATE order_job_attempts
    SET status = $1,
        finished_at = ${nowExpression}
    WHERE job_id = $2
      AND attempt_number = $3
  `;
  let params = [status, jobId, attemptNumber];

  if (errorMessage) {
    sql = `
      UPDATE order_job_attempts
      SET status = $1,
          error_message = $2,
          finished_at = ${nowExpression}
      WHERE job_id = $3
        AND attempt_number = $4
    `;
    params = [status, errorMessage, jobId, attemptNumber];
  }

  await db.query(sql, params);
}

async function handleJob(job) {
  const payload = parsePayload(job.payload);
  const actions = payload.actions || {};
  const attemptNumber = job.attempts;

  await db.query(
    `
    INSERT INTO order_job_attempts (job_id, attempt_number, status)
    VALUES ($1, $2, 'started')
    `,
    [job.id, attemptNumber]
  );

  try {
    const context = {
      orderId: payload.order_id || job.order_id,
      lojaId: payload.loja_id || job.loja_id
    };

    if (actions.send_whatsapp) {
      await sendWhatsAppNotification(context);
    }

    if (actions.send_email) {
      await sendEmailNotification(context);
    }

    if (actions.integrate_erp) {
      await integrateWithErp(context);
    }

    if (job.job_type === 'order_push_notification') {
      await processOrderPushJob(job);
    }

    await db.query(
      `
      UPDATE order_jobs
      SET status = 'completed',
          completed_at = ${nowExpression},
          updated_at = ${nowExpression}
      WHERE id = $1
      `,
      [job.id]
    );

    await markAttempt(job.id, attemptNumber, 'completed');
  } catch (err) {
    const errorMessage = err?.message || 'Erro ao executar job';
    const shouldRetry = job.attempts < job.max_attempts;
    const nextRunAt = shouldRetry
      ? new Date(Date.now() + calculateBackoffMs(job.attempts))
      : job.run_at;

    await db.query(
      `
      UPDATE order_jobs
      SET status = 'failed',
          last_error = $2,
          run_at = $3,
          updated_at = ${nowExpression}
      WHERE id = $1
      `,
      [job.id, errorMessage, nextRunAt]
    );

    await markAttempt(job.id, attemptNumber, 'failed', errorMessage);
  }
}

async function poll() {
  for (let i = 0; i < BATCH_SIZE; i += 1) {
    const job = await fetchNextJob();
    if (!job) break;
    await handleJob(job);
  }
}

async function start() {
  console.log('[order-jobs] Worker iniciado');
  await poll();
  setInterval(() => {
    poll().catch(err => {
      console.error('[order-jobs] Erro no polling', err);
    });
  }, POLL_INTERVAL_MS);
}

process.on('SIGINT', () => {
  console.log('[order-jobs] Encerrando worker');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('[order-jobs] Encerrando worker');
  process.exit(0);
});

start().catch(err => {
  console.error('[order-jobs] Falha ao iniciar worker', err);
  process.exit(1);
});
