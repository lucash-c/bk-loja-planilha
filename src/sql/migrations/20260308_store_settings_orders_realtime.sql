ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS orders_realtime_enabled BOOLEAN DEFAULT FALSE;
