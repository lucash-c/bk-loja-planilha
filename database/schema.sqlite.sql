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
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    loja_id TEXT NOT NULL,

    name TEXT NOT NULL,
    description TEXT,
    base_price REAL NOT NULL DEFAULT 0,

    image_url TEXT,

    has_options INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,

    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (loja_id) REFERENCES lojas(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_products_loja_id ON products(loja_id);

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
