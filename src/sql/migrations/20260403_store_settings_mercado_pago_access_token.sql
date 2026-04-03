ALTER TABLE store_settings
    ADD COLUMN IF NOT EXISTS mercado_pago_access_token TEXT;
