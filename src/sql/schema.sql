-- ==========================================
-- EXTENSÕES NECESSÁRIAS
-- ==========================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-------------------------------------------------------------
-- USERS (administradores do painel e futuros clientes)
-------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin', -- admin ou staff
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-------------------------------------------------------------
-- ORDERS (pedidos)
-------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT UNIQUE, -- ID exibido no frontend
    customer_name TEXT,
    customer_whatsapp TEXT,
    delivery_address TEXT,
    total NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'pending',
    status TEXT DEFAULT 'new', -- new, preparing, out_for_delivery, delivered, canceled
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-------------------------------------------------------------
-- ORDER_ITEMS (itens do pedido)
-------------------------------------------------------------
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_name TEXT,
    quantity INTEGER,
    unit_price NUMERIC(10,2),
    total_price NUMERIC(10,2)
);

-------------------------------------------------------------
-- PASSWORD RESETS (códigos de recuperação)
-------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_resets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    code TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-------------------------------------------------------------
-- STORE SETTINGS (configurações da loja)
-------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_settings (
    id SERIAL PRIMARY KEY,
    store_name VARCHAR(100) NOT NULL,
    whatsapp VARCHAR(30) NOT NULL,
    pix_key VARCHAR(255),
    pix_qr_image TEXT,
    open_time VARCHAR(10),
    close_time VARCHAR(10),
    is_open BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Trigger: atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_store_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_update_store_settings
BEFORE UPDATE ON store_settings
FOR EACH ROW
EXECUTE PROCEDURE update_store_settings_timestamp();

-------------------------------------------------------------
-- SESSIONS (controle de login)
-------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    ip VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
