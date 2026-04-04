ALTER TABLE public_pix_checkout_sessions
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;

UPDATE public_pix_checkout_sessions
SET expires_at = COALESCE(expires_at, created_at + INTERVAL '15 minutes')
WHERE expires_at IS NULL;

ALTER TABLE public_pix_checkout_sessions
    ALTER COLUMN expires_at SET NOT NULL;
