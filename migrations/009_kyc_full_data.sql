-- ============================================================
-- Migration 009: Plis chan done KYC Didit (non verifye, nasyonalite)
-- ============================================================
-- Didit voye plis enfo nan dokiman ID a pase sa nou t ap sove deja
-- (nimewo/tip/peyi ID). Ajoute chan pou non verifye ak nasyonalite,
-- pou n ka itilize done Didit deja verifye a olye default/fallback.

ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_first_name  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_last_name   TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_nationality TEXT;

COMMENT ON COLUMN users.kyc_first_name  IS 'Prenon jan li parèt sou dokiman ID verifye pa Didit';
COMMENT ON COLUMN users.kyc_last_name   IS 'Non fanmi jan li parèt sou dokiman ID verifye pa Didit';
COMMENT ON COLUMN users.kyc_nationality IS 'Nasyonalite (ISO alpha-2) jan Didit ekstrè l nan dokiman an';
