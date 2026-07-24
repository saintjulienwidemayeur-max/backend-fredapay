-- ============================================================
-- Migration 004 — Kolòn ki manke nan tablo existant yo
-- Kole nan: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- users — ajoute kolòn ki kapab manke
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url        TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status        TEXT DEFAULT 'not_started';
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_session_id    TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified    BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at     TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE users ADD COLUMN IF NOT EXISTS dial_code         TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city              TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS address           TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth     DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS genre             CHAR(1);

-- wallets — kolòn manke
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS available_balance INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pending_balance   INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS balance          INTEGER DEFAULT 0;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS is_active        BOOLEAN DEFAULT TRUE;
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS currency         TEXT DEFAULT 'USD';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ DEFAULT NOW();

-- Trigger updated_at pou users si pa egziste
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Verifye kolonn users yo
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'users' AND table_schema = 'public'
ORDER BY ordinal_position;
