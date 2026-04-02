const DEBUG_ENV_KEYS = ['PEDIDO_DEBUG_API', 'DEBUG_PEDIDO_API'];
const DEBUG_NAMESPACES = ['pedido-debug-api', 'orders:debug', 'orders-debug'];

function hasTruthyEnvFlag() {
  return DEBUG_ENV_KEYS.some(key => {
    const value = process.env[key];
    if (typeof value !== 'string') return false;
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  });
}

function hasDebugNamespace() {
  const value = process.env.DEBUG;
  if (typeof value !== 'string') return false;
  const normalized = value.toLowerCase();
  return DEBUG_NAMESPACES.some(namespace => normalized.includes(namespace));
}

function isPedidoDebugEnabled() {
  return hasTruthyEnvFlag() || hasDebugNamespace();
}

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  const summary = {};
  for (const [key, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      summary[key] = `[array:${value.length}]`;
      continue;
    }

    if (value && typeof value === 'object') {
      summary[key] = '[object]';
      continue;
    }

    summary[key] = value;
  }

  return summary;
}

function pedidoDebugLog(event, payload) {
  if (!isPedidoDebugEnabled()) return;
  if (typeof payload === 'undefined') {
    console.info(`[pedido-debug-api] ${event}`);
    return;
  }

  console.info(`[pedido-debug-api] ${event}`, summarizePayload(payload));
}

module.exports = {
  pedidoDebugLog,
  isPedidoDebugEnabled
};
