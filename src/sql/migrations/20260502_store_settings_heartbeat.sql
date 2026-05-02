ALTER TABLE store_settings
ADD COLUMN IF NOT EXISTS last_pdv_heartbeat_at TIMESTAMP NULL;

CREATE INDEX IF NOT EXISTS idx_store_settings_open_heartbeat
ON store_settings (is_open, last_pdv_heartbeat_at);
