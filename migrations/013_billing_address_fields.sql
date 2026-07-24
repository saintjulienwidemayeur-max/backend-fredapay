-- ============================================================
-- Migration 013: Chan adrès konplè pou "billing address" Maplerad
-- ============================================================
-- Maplerad mande yon adrès konplè (street, city, state, postal_code,
-- country) pou Tier 1 KYC — sa a sèvi kòm adrès sou dosye pou kat la
-- (itilize pou AVS lè kliyan achte sou sit machann Ameriken yo).
-- Kòd la te itilize "N/A" ak city kòm fallback pou state — enkòrèk.

ALTER TABLE users ADD COLUMN IF NOT EXISTS state       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS postal_code TEXT;

COMMENT ON COLUMN users.state       IS 'Eta/Depatman (egzanp: Ouest, Nord) — pou adrès Maplerad Tier 1';
COMMENT ON COLUMN users.postal_code IS 'Kòd postal — pou adrès Maplerad Tier 1 (AVS)';
