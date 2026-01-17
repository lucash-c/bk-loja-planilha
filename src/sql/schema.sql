-- ==========================================
-- EXTENSÕES NECESSÁRIAS
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==========================================
-- USERS
-- ==========================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    whatsapp VARCHAR(30),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================
-- LOJAS
-- ==========================================
CREATE TABLE IF NOT EXISTS lojas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    public_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    whatsapp VARCHAR(30) NOT NULL,
    telefone VARCHAR(30),
    responsavel_nome TEXT NOT NULL,
    email TEXT NOT NULL,
    cpf_cnpj TEXT NOT NULL,
    pais TEXT NOT NULL,
    estado TEXT NOT NULL,
    cidade TEXT NOT NULL,
    bairro TEXT NOT NULL,
    rua TEXT NOT NULL,
    numero TEXT NOT NULL,
    cep TEXT NOT NULL,
    facebook TEXT,
    instagram TEXT,
    tiktok TEXT,
    logo TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lojas_public_key ON lojas(public_key);
CREATE INDEX IF NOT EXISTS idx_lojas_cpf_cnpj ON lojas(cpf_cnpj);

-- ==========================================
-- USER_LOJAS
-- ==========================================
CREATE TABLE IF NOT EXISTS user_lojas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'owner',
    credits NUMERIC(10,2) DEFAULT 0 CHECK (credits >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, loja_id)
);

-- ==========================================
-- STORE_SETTINGS
-- ==========================================
CREATE TABLE IF NOT EXISTS store_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID UNIQUE NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    pix_key VARCHAR(255),
    pix_qr_image TEXT,
    open_time VARCHAR(10),
    close_time VARCHAR(10),
    is_open BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================
-- STORE_DELIVERY_FEES (FRETE POR DISTÂNCIA)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_delivery_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    distance_km INTEGER NOT NULL CHECK (distance_km >= 0),
    fee NUMERIC(10,2) NOT NULL DEFAULT 0,
    estimated_time_minutes INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (loja_id, distance_km)
);

CREATE INDEX IF NOT EXISTS idx_delivery_fees_loja ON store_delivery_fees(loja_id);

-- ==========================================
-- ORDERS
-- ==========================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    external_id TEXT,
    customer_name TEXT,
    customer_whatsapp TEXT,
    delivery_address TEXT,
    delivery_distance_km INTEGER,
    delivery_estimated_time_minutes INTEGER,
    delivery_fee NUMERIC(10,2) NOT NULL DEFAULT 0,
    total NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_method TEXT,
    origin TEXT NOT NULL DEFAULT 'cliente',
    payment_status TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'new',
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_loja_id ON orders(loja_id);

-- ==========================================
-- ORDER_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(10,2) NOT NULL CHECK (total_price >= 0),
    observation TEXT,
    options_json JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================
-- PRODUCTS
-- ==========================================
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    image_url TEXT,
    has_options BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================
-- PRODUCT_OPTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS product_options (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'single',
    required BOOLEAN DEFAULT FALSE,
    min_choices INTEGER DEFAULT 0,
    max_choices INTEGER DEFAULT 1,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================
-- PRODUCT_OPTION_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS product_option_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_id UUID NOT NULL REFERENCES product_options(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_visible BOOLEAN DEFAULT TRUE
);

-- ==========================================
-- PASSWORD RESETS
-- ==========================================
CREATE TABLE IF NOT EXISTS password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ==========================================
-- SESSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    ip VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- ==========================================
-- SALES SUMMARY (RESUMO MENSAL DE VENDAS)
-- ==========================================
CREATE TABLE IF NOT EXISTS sales_summary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,

    year INTEGER NOT NULL,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),

    total_orders INTEGER NOT NULL DEFAULT 0,
    total_items INTEGER NOT NULL DEFAULT 0,

    subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_delivery_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_revenue NUMERIC(12,2) NOT NULL DEFAULT 0,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),

    UNIQUE (loja_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_sales_summary_loja
    ON sales_summary(loja_id);

CREATE INDEX IF NOT EXISTS idx_sales_summary_period
    ON sales_summary(year, month);
