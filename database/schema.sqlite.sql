PRAGMA foreign_keys = ON;

-- ==========================================
-- USERS
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    whatsapp TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- LOJAS
-- ==========================================
CREATE TABLE IF NOT EXISTS lojas (
    id TEXT PRIMARY KEY,
    public_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lojas_public_key ON lojas(public_key);

-- ==========================================
-- USER_LOJAS
-- ==========================================
CREATE TABLE IF NOT EXISTS user_lojas (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    loja_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'owner',
    credits REAL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, loja_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_lojas_user_id ON user_lojas(user_id);
CREATE INDEX IF NOT EXISTS idx_user_lojas_loja_id ON user_lojas(loja_id);

-- ==========================================
-- STORE_SETTINGS
-- ==========================================
CREATE TABLE IF NOT EXISTS store_settings (
    id TEXT PRIMARY KEY,
    loja_id TEXT UNIQUE NOT NULL,
    mercado_pago_access_token TEXT,
    pix_key TEXT,
    pix_qr_image TEXT,
    open_time TEXT,
    close_time TEXT,
    is_open INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
);

-- ==========================================
-- STORE_PAYMENT_METHODS (FORMAS DE PAGAMENTO)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_payment_methods (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    requires_change INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (loja_id, code),
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_store_payment_methods_loja_id ON store_payment_methods(loja_id);

-- ==========================================
-- ORDERS
-- ==========================================
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    external_id TEXT,
    customer_name TEXT,
    customer_whatsapp TEXT,
    delivery_address TEXT,
    total REAL NOT NULL DEFAULT 0,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'new',
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_loja_id ON orders(loja_id);
CREATE INDEX IF NOT EXISTS idx_orders_external_id ON orders(external_id);

-- ==========================================
-- PUBLIC_PIX_CHECKOUT_SESSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS public_pix_checkout_sessions (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    public_key TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    payment_id TEXT,
    txid TEXT,
    raw_order_payload TEXT NOT NULL,
    amount REAL NOT NULL CHECK (amount >= 0),
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    order_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (loja_id, correlation_id),
    UNIQUE (loja_id, payment_id),
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_public_pix_checkout_sessions_lookup
    ON public_pix_checkout_sessions(loja_id, payment_id, correlation_id);

-- ==========================================
-- ORDER_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    total_price REAL NOT NULL CHECK (total_price >= 0),

    -- Opções escolhidas (JSON em texto)
    options_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- ==========================================
-- PRODUCTS
-- ==========================================
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    image_url TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    category_id TEXT,

    name TEXT NOT NULL,
    description TEXT,
    base_price REAL NOT NULL DEFAULT 0,

    image_url TEXT,

    has_options INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_products_loja_id ON products(loja_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_loja_category_created_at
    ON products(loja_id, category_id, created_at DESC, id DESC);

-- ==========================================
-- OPTION_GROUPS
-- ==========================================
CREATE TABLE IF NOT EXISTS option_groups (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_option_groups_loja_id ON option_groups(loja_id);

-- ==========================================
-- PRODUCT_OPTION_GROUPS
-- ==========================================
CREATE TABLE IF NOT EXISTS product_option_groups (
    product_id TEXT NOT NULL,
    option_group_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, option_group_id),
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY (option_group_id) REFERENCES option_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_option_groups_option_group
    ON product_option_groups(option_group_id);

-- ==========================================
-- PRODUCT_OPTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS product_options (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,

    name TEXT NOT NULL,
    required INTEGER DEFAULT 0,
    min_choices INTEGER DEFAULT 0,
    max_choices INTEGER DEFAULT 1,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_product_options_product_id ON product_options(product_id);

-- ==========================================
-- PRODUCT_OPTION_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS product_option_items (
    id TEXT PRIMARY KEY,
    option_id TEXT NOT NULL,

    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,

    is_active INTEGER DEFAULT 1,

    FOREIGN KEY (option_id) REFERENCES product_options(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_option_items_option_id ON product_option_items(option_id);


-- ==========================================
-- PASSWORD_RESETS
-- ==========================================
CREATE TABLE IF NOT EXISTS password_resets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ==========================================
-- SESSIONS (opcional)
-- ==========================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);


-- ==========================================
-- PDV_PUSH_SUBSCRIPTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS pdv_push_subscriptions (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(loja_id, endpoint),
    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pdv_push_subscriptions_loja_enabled
    ON pdv_push_subscriptions(loja_id, enabled);

-- ==========================================
-- ORDER_PUSH_DELIVERIES
-- ==========================================
CREATE TABLE IF NOT EXISTS order_push_deliveries (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subscription_id TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    provider_status_code INTEGER,
    error_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(order_id, event_type, subscription_id),
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (subscription_id) REFERENCES pdv_push_subscriptions(id) ON DELETE CASCADE
);
