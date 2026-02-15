const PREFIX = 'idempotency';
const DEFAULT_TTL_SECONDS = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 900);
const LOCK_VALUE = '__processing__';

const memoryStore = new Map();
let redisClient;
let redisReady = false;
let redisUnavailable = false;
let redisDisabledLogged = false;

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function getKey(storeId, scope, idempotencyKey) {
  return `${PREFIX}:${storeId}:${scope}:${idempotencyKey}`;
}

async function getRedisClient() {
  if (!process.env.REDIS_URL || redisUnavailable) return null;

  if (!redisClient) {
    let createClient;
    try {
      ({ createClient } = require('redis'));
    } catch (err) {
      redisUnavailable = true;
      console.warn('[idempotency] pacote redis indisponível; usando fallback local em memória');
      return null;
    }

    redisClient = createClient({
      url: process.env.REDIS_URL,
      socket: {
        reconnectStrategy: retries => Math.min(2000, retries * 100)
      }
    });

    redisClient.on('error', err => {
      redisReady = false;
      console.error('[idempotency] erro Redis', err.message);
    });

    redisClient.on('ready', () => {
      redisReady = true;
    });

    await redisClient.connect();
  }

  if (!redisReady && redisClient.isReady) {
    redisReady = true;
  }

  return redisReady ? redisClient : null;
}

function getMemoryEntry(key) {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryStore.delete(key);
    return null;
  }
  return entry;
}

async function beginProcessing({ storeId, scope, idempotencyKey, requestHash, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const cacheKey = getKey(storeId, scope, idempotencyKey);
  const lockPayload = JSON.stringify({
    status: 'processing',
    requestHash,
    createdAt: new Date().toISOString()
  });

  const client = await getRedisClient();
  if (client) {
    const setResult = await client.set(cacheKey, lockPayload, {
      NX: true,
      EX: ttlSeconds
    });

    if (setResult === 'OK') {
      return { acquired: true, cacheKey };
    }

    const existing = safeJsonParse(await client.get(cacheKey));
    if (!existing) {
      return { acquired: false, state: 'processing' };
    }

    if (existing.requestHash && existing.requestHash !== requestHash) {
      return { acquired: false, state: 'payload_mismatch' };
    }

    if (existing.status === 'completed') {
      return {
        acquired: false,
        state: 'completed',
        response: existing.response,
        statusCode: existing.statusCode || 200
      };
    }

    return { acquired: false, state: 'processing' };
  }

  if (!redisDisabledLogged) {
    redisDisabledLogged = true;
    console.warn('[idempotency] REDIS_URL não configurada; usando fallback local em memória');
  }

  const existing = getMemoryEntry(cacheKey);
  if (!existing) {
    memoryStore.set(cacheKey, {
      value: {
        status: 'processing',
        requestHash,
        response: LOCK_VALUE,
        statusCode: 202
      },
      expiresAt: Date.now() + ttlSeconds * 1000
    });
    return { acquired: true, cacheKey };
  }

  if (existing.value.requestHash && existing.value.requestHash !== requestHash) {
    return { acquired: false, state: 'payload_mismatch' };
  }

  if (existing.value.status === 'completed') {
    return {
      acquired: false,
      state: 'completed',
      response: existing.value.response,
      statusCode: existing.value.statusCode || 200
    };
  }

  return { acquired: false, state: 'processing' };
}

async function saveCompletedResponse({ storeId, scope, idempotencyKey, requestHash, statusCode = 200, response, ttlSeconds = DEFAULT_TTL_SECONDS }) {
  const cacheKey = getKey(storeId, scope, idempotencyKey);
  const payload = JSON.stringify({
    status: 'completed',
    requestHash,
    statusCode,
    response,
    completedAt: new Date().toISOString()
  });

  const client = await getRedisClient();
  if (client) {
    await client.set(cacheKey, payload, { EX: ttlSeconds });
    return;
  }

  memoryStore.set(cacheKey, {
    value: {
      status: 'completed',
      requestHash,
      statusCode,
      response
    },
    expiresAt: Date.now() + ttlSeconds * 1000
  });
}

function resetMemoryStore() {
  memoryStore.clear();
}

module.exports = {
  beginProcessing,
  saveCompletedResponse,
  resetMemoryStore
};
