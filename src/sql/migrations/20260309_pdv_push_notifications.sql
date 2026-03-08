CREATE TABLE IF NOT EXISTS pdv_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (loja_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_pdv_push_subscriptions_loja_enabled
    ON pdv_push_subscriptions(loja_id, enabled);

CREATE TABLE IF NOT EXISTS order_push_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    subscription_id UUID NOT NULL REFERENCES pdv_push_subscriptions(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
    provider_status_code INTEGER,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (order_id, event_type, subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_order_push_deliveries_order_event
    ON order_push_deliveries(order_id, event_type);
