CREATE TABLE IF NOT EXISTS payment_refund_requests (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    payment_id TEXT NOT NULL,
    correlation_id TEXT,
    session_id TEXT,
    order_id TEXT,
    trigger_reason TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_response_payload TEXT,
    idempotency_key TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_refund_requests_lookup
    ON payment_refund_requests(loja_id, payment_id, trigger_reason);
