const { randomUUID } = require('crypto');

const EVENT_VERSION = 'v1';
const RETENTION_LIMIT = 200;
const HEARTBEAT_INTERVAL_MS = 25000;
const ZOMBIE_TIMEOUT_MS = 90000;
const MAX_EVENTS_PER_CONNECTION = 2000;

class OrdersRealtimeService {
  constructor() {
    this.connectionsByStore = new Map();
    this.recentEventsByStore = new Map();
    this.metrics = {
      emitted: 0,
      delivered: 0,
      authErrors: 0,
      reconnects: 0
    };
  }

  markAuthError() {
    this.metrics.authErrors += 1;
  }

  nextConnectionId() {
    return randomUUID();
  }

  getActiveConnections(storeId) {
    if (!storeId) return 0;
    return (this.connectionsByStore.get(storeId) || new Set()).size;
  }

  registerConnection({ req, res, userId, storeId, lastEventId }) {
    const connectionId = this.nextConnectionId();
    const connectedAt = new Date().toISOString();
    const connection = {
      id: connectionId,
      userId,
      storeId,
      req,
      res,
      connectedAt,
      deliveredCount: 0,
      lastSeenAt: Date.now(),
      heartbeat: null,
      zombieMonitor: null,
      closed: false
    };

    if (lastEventId) {
      this.metrics.reconnects += 1;
    }

    if (!this.connectionsByStore.has(storeId)) {
      this.connectionsByStore.set(storeId, new Set());
    }
    this.connectionsByStore.get(storeId).add(connection);

    console.info('[orders-realtime:connect]', {
      connection_id: connectionId,
      user_id: userId,
      store_id: storeId,
      ip: req.ip,
      user_agent: req.headers['user-agent'] || 'unknown',
      connected_at: connectedAt
    });

    this.sendSse(connection, 'connected', {
      ok: true,
      connection_id: connectionId,
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
      event_version: EVENT_VERSION
    });

    if (lastEventId) {
      this.replayEvents({ connection, lastEventId });
    }

    connection.heartbeat = setInterval(() => {
      this.sendSse(connection, 'heartbeat', { ts: new Date().toISOString() });
    }, HEARTBEAT_INTERVAL_MS);

    connection.zombieMonitor = setInterval(() => {
      if (Date.now() - connection.lastSeenAt > ZOMBIE_TIMEOUT_MS) {
        this.closeConnection(connection, 'zombie_timeout');
      }
    }, HEARTBEAT_INTERVAL_MS);

    req.on('close', () => this.closeConnection(connection, 'client_closed'));

    return connectionId;
  }

  closeConnection(connection, reason) {
    if (!connection || connection.closed) return;
    connection.closed = true;

    if (connection.heartbeat) clearInterval(connection.heartbeat);
    if (connection.zombieMonitor) clearInterval(connection.zombieMonitor);

    const set = this.connectionsByStore.get(connection.storeId);
    if (set) {
      set.delete(connection);
      if (!set.size) this.connectionsByStore.delete(connection.storeId);
    }

    const disconnectedAt = new Date().toISOString();
    console.info('[orders-realtime:disconnect]', {
      connection_id: connection.id,
      user_id: connection.userId,
      store_id: connection.storeId,
      reason,
      connected_at: connection.connectedAt,
      disconnected_at: disconnectedAt
    });

    try {
      connection.res.end();
    } catch (err) {
      // ignore
    }
  }

  buildEvent({ type, order, storeId }) {
    return {
      id: randomUUID(),
      type,
      event_version: EVENT_VERSION,
      store_id: storeId,
      created_at: new Date().toISOString(),
      payload: {
        id: order.id,
        status: order.status || 'new',
        created_at: order.created_at || new Date().toISOString(),
        customer: {
          name: order.customer_name || 'Cliente',
          ...(order.customer_whatsapp ? { phone: order.customer_whatsapp } : {})
        },
        total: Number(order.total || 0)
      }
    };
  }

  publish({ type, order, storeId }) {
    if (!storeId || !order?.id) return null;
    const event = this.buildEvent({ type, order, storeId });
    this.metrics.emitted += 1;

    if (!this.recentEventsByStore.has(storeId)) {
      this.recentEventsByStore.set(storeId, []);
    }
    const list = this.recentEventsByStore.get(storeId);
    list.push(event);
    if (list.length > RETENTION_LIMIT) {
      list.splice(0, list.length - RETENTION_LIMIT);
    }

    const connections = this.connectionsByStore.get(storeId) || new Set();
    for (const connection of connections) {
      if (connection.deliveredCount >= MAX_EVENTS_PER_CONNECTION) {
        this.closeConnection(connection, 'max_events_reached');
        continue;
      }
      this.sendSse(connection, 'order_event', {
        type: event.type,
        payload: event.payload
      }, event.id);
      connection.deliveredCount += 1;
      this.metrics.delivered += 1;

      const latencyMs = Date.now() - new Date(event.created_at).getTime();
      console.info('[orders-realtime:delivery]', {
        connection_id: connection.id,
        store_id: storeId,
        order_id: event.payload.id,
        event_type: event.type,
        latency_ms: latencyMs
      });
    }

    return event;
  }

  replayEvents({ connection, lastEventId }) {
    const list = this.recentEventsByStore.get(connection.storeId) || [];
    const index = list.findIndex(evt => evt.id === lastEventId);
    if (index < 0 || index === list.length - 1) return;

    const pending = list.slice(index + 1);
    pending.forEach(event => {
      this.sendSse(connection, 'order_event', {
        type: event.type,
        payload: event.payload
      }, event.id);
      connection.deliveredCount += 1;
      this.metrics.delivered += 1;
    });
  }

  sendSse(connection, event, data, id) {
    if (connection.closed) return;
    connection.lastSeenAt = Date.now();

    if (id) {
      connection.res.write(`id: ${id}\n`);
    }
    connection.res.write(`event: ${event}\n`);
    connection.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

module.exports = {
  EVENT_VERSION,
  ordersRealtimeService: new OrdersRealtimeService()
};
