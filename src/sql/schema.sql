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
    orders_realtime_enabled BOOLEAN DEFAULT FALSE,
    is_open BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS orders_realtime_enabled BOOLEAN DEFAULT FALSE;

-- ==========================================
-- STORE_DELIVERY_FEES (FRETE POR DISTÂNCIA)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_delivery_fees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    distance_km NUMERIC(10,2) NOT NULL CHECK (distance_km >= 0),
    fee NUMERIC(10,2) NOT NULL DEFAULT 0,
    estimated_time_minutes INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (loja_id, distance_km)
);

CREATE INDEX IF NOT EXISTS idx_delivery_fees_loja ON store_delivery_fees(loja_id);

-- ==========================================
-- STORE_PAYMENT_METHODS (FORMAS DE PAGAMENTO)
-- ==========================================
CREATE TABLE IF NOT EXISTS store_payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    label TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    requires_change BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (loja_id, code)
);

CREATE INDEX IF NOT EXISTS idx_store_payment_methods_loja
    ON store_payment_methods(loja_id);

-- ==========================================
-- ORDERS
-- ==========================================
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    external_id TEXT,
    customer_name TEXT,
    customer_whatsapp TEXT,
    order_type TEXT NOT NULL DEFAULT 'entrega' CHECK (order_type IN ('entrega', 'retirada', 'local')),
    delivery_address TEXT,
    delivery_distance_km NUMERIC(10,2),
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
-- PUBLIC_PIX_CHECKOUT_SESSIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS public_pix_checkout_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    payment_id TEXT,
    txid TEXT,
    raw_order_payload JSONB NOT NULL,
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    payment_method TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'failed', 'expired', 'cancelled', 'converted')),
    order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (loja_id, correlation_id),
    UNIQUE (loja_id, payment_id)
);

CREATE INDEX IF NOT EXISTS idx_public_pix_checkout_sessions_lookup
    ON public_pix_checkout_sessions(loja_id, payment_id, correlation_id);

-- ==========================================
-- ORDER_JOBS (AÇÕES PÓS-CRIAÇÃO DE PEDIDO)
-- ==========================================
CREATE TABLE IF NOT EXISTS order_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    job_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    payload JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    last_error TEXT,
    run_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    locked_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_jobs_status_run_at
    ON order_jobs(status, run_at);

CREATE INDEX IF NOT EXISTS idx_order_jobs_order_id
    ON order_jobs(order_id);

-- ==========================================
-- ORDER_JOB_ATTEMPTS (OBSERVABILIDADE)
-- ==========================================
CREATE TABLE IF NOT EXISTS order_job_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES order_jobs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('started', 'failed', 'completed')),
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    finished_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_order_job_attempts_job_id
    ON order_job_attempts(job_id);


-- ==========================================
-- PDV_PUSH_SUBSCRIPTIONS
-- ==========================================
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

-- ==========================================
-- ORDER_PUSH_DELIVERIES (IDEMPOTÊNCIA DE PUSH)
-- ==========================================
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
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_loja_id ON categories(loja_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_loja_slug
    ON categories(loja_id, slug);

CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    base_price NUMERIC(10,2) NOT NULL DEFAULT 0,
    image_url TEXT,
    has_options BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Migração segura para bases existentes
ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS loja_id UUID REFERENCES lojas(id) ON DELETE CASCADE;

-- 1) Se a categoria estiver vinculada a produtos de apenas uma loja,
--    usa essa loja para preencher categories.loja_id.
WITH categoria_loja_unica AS (
    SELECT
        p.category_id,
        MIN(p.loja_id) AS loja_id
    FROM products p
    WHERE p.category_id IS NOT NULL
    GROUP BY p.category_id
    HAVING COUNT(DISTINCT p.loja_id) = 1
)
UPDATE categories c
SET loja_id = clu.loja_id
FROM categoria_loja_unica clu
WHERE c.id = clu.category_id
  AND c.loja_id IS NULL;

-- 2) Se a categoria estiver em múltiplas lojas, mantém a categoria original
--    em uma loja base e cria clones por loja adicional.
WITH categoria_multiloja AS (
    SELECT
        p.category_id,
        ARRAY_AGG(DISTINCT p.loja_id ORDER BY p.loja_id) AS lojas
    FROM products p
    WHERE p.category_id IS NOT NULL
    GROUP BY p.category_id
    HAVING COUNT(DISTINCT p.loja_id) > 1
), loja_base AS (
    SELECT
        cml.category_id,
        cml.lojas[1] AS base_loja_id,
        cml.lojas[2:ARRAY_LENGTH(cml.lojas, 1)] AS outras_lojas
    FROM categoria_multiloja cml
), categorias_base_atualizadas AS (
    UPDATE categories c
    SET loja_id = lb.base_loja_id
    FROM loja_base lb
    WHERE c.id = lb.category_id
      AND c.loja_id IS NULL
    RETURNING c.id, c.name, c.slug, c.image_url, c.created_at
), clones_criados AS (
    INSERT INTO categories (id, loja_id, name, slug, image_url, created_at)
    SELECT
        gen_random_uuid(),
        loja_destino.loja_id,
        cba.name,
        cba.slug,
        cba.image_url,
        cba.created_at
    FROM categorias_base_atualizadas cba
    JOIN loja_base lb ON lb.category_id = cba.id
    CROSS JOIN LATERAL UNNEST(lb.outras_lojas) AS loja_destino(loja_id)
    RETURNING id, loja_id, name, slug
)
UPDATE products p
SET category_id = cc.id
FROM categories categoria_origem
JOIN clones_criados cc
  ON cc.name = categoria_origem.name
 AND cc.slug = categoria_origem.slug
WHERE p.category_id = categoria_origem.id
  AND p.loja_id = cc.loja_id
  AND categoria_origem.loja_id IS NOT NULL
  AND categoria_origem.loja_id <> cc.loja_id;

-- 3) Categorias sem produtos: aplica loja padrão (primeira loja existente) para saneamento.
WITH loja_padrao AS (
    SELECT id
    FROM lojas
    ORDER BY created_at, id
    LIMIT 1
)
UPDATE categories c
SET loja_id = lp.id
FROM loja_padrao lp
WHERE c.loja_id IS NULL;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM categories WHERE loja_id IS NULL) THEN
        RAISE EXCEPTION 'Ainda existem categorias sem loja_id. Revise os dados antes de concluir a migração.';
    END IF;
END $$;

ALTER TABLE categories
    ALTER COLUMN loja_id SET NOT NULL;

DROP INDEX IF EXISTS idx_categories_slug;
CREATE INDEX IF NOT EXISTS idx_categories_loja_id ON categories(loja_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_loja_slug
    ON categories(loja_id, slug);

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_loja_category_created_at
    ON products(loja_id, category_id, created_at DESC, id DESC);

-- ==========================================
-- OPTION_GROUPS
-- ==========================================
CREATE TABLE IF NOT EXISTS option_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loja_id UUID NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'single',
    required BOOLEAN DEFAULT FALSE,
    min_choices INTEGER DEFAULT 0,
    max_choices INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_option_groups_loja_id ON option_groups(loja_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_option_groups_loja_name_unique
    ON option_groups(loja_id, lower(name));

-- ==========================================
-- OPTION_GROUP_ITEMS
-- ==========================================
CREATE TABLE IF NOT EXISTS option_group_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    option_group_id UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_option_group_items_group_id
    ON option_group_items(option_group_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_option_group_items_group_name_unique
    ON option_group_items(option_group_id, lower(name));

-- ==========================================
-- PRODUCT_OPTION_GROUPS
-- ==========================================
CREATE TABLE IF NOT EXISTS product_option_groups (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    option_group_id UUID NOT NULL REFERENCES option_groups(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    PRIMARY KEY (product_id, option_group_id)
);

CREATE INDEX IF NOT EXISTS idx_product_option_groups_option_group
    ON product_option_groups(option_group_id);

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
