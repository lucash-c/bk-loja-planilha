ALTER TABLE categories
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

UPDATE categories
SET is_active = TRUE
WHERE is_active IS NULL;
