const db = require('../config/db');

const HEARTBEAT_TIMEOUT_MINUTES = Number(process.env.STORE_HEARTBEAT_TIMEOUT_MINUTES || 15);

function getInactiveConditionSql() {
  if (db.supportsForUpdate) {
    return `COALESCE(last_pdv_heartbeat_at, updated_at) < NOW() - INTERVAL '${HEARTBEAT_TIMEOUT_MINUTES} minutes'`;
  }

  return `datetime(COALESCE(last_pdv_heartbeat_at, updated_at)) < datetime('now', '-${HEARTBEAT_TIMEOUT_MINUTES} minutes')`;
}

async function closeInactiveStores() {
  const inactiveConditionSql = getInactiveConditionSql();

  const hasInactive = await db.query(
    `
    SELECT 1
    FROM store_settings
    WHERE is_open = TRUE
      AND (${inactiveConditionSql})
    LIMIT 1
    `
  );

  if (hasInactive.rows.length === 0) {
    return { updated: 0 };
  }

  const result = await db.query(
    `
    UPDATE store_settings
    SET is_open = FALSE,
        updated_at = CURRENT_TIMESTAMP
    WHERE is_open = TRUE
      AND (${inactiveConditionSql})
    `
  );

  return { updated: result.rowCount || 0 };
}

function startInactiveStoreScheduler() {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  return setInterval(() => {
    closeInactiveStores().catch((err) => {
      console.error('Erro ao fechar lojas inativas automaticamente:', err);
    });
  }, 4 * 60 * 1000);
}

module.exports = {
  closeInactiveStores,
  startInactiveStoreScheduler,
  HEARTBEAT_TIMEOUT_MINUTES
};
