-- ============================================================
-- Migration 006 — Colonnes KYC + Maplerad Tier
-- Exécuter dans: Supabase Dashboard → SQL Editor
-- ============================================================

-- Numéro pièce d'identité vérifié par Didit
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_id_number   TEXT;

-- Type de pièce: PASSPORT, NIN, DRIVERS_LICENSE, VOTERS_CARD
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_id_type     TEXT;

-- Pays de la pièce d'identité (ISO alpha-2, ex: "HT", "US")
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_id_country  TEXT;

-- Tier Maplerad actuel: 0=Tier0, 1=Tier1, 2=Tier2
ALTER TABLE users ADD COLUMN IF NOT EXISTS maplerad_tier   INTEGER DEFAULT 0;

-- Commentaires pour documentation
COMMENT ON COLUMN users.kyc_id_number  IS 'Numéro pièce ID vérifié par Didit KYC';
COMMENT ON COLUMN users.kyc_id_type    IS 'Type de pièce ID: PASSPORT, NIN, DRIVERS_LICENSE';
COMMENT ON COLUMN users.kyc_id_country IS 'Pays de la pièce ID (ISO alpha-2)';
COMMENT ON COLUMN users.maplerad_tier  IS 'Niveau Maplerad: 0=Tier0, 1=Tier1, 2=Tier2';

-- Index pour recherche rapide par tier
CREATE INDEX IF NOT EXISTS idx_users_maplerad_tier ON users(maplerad_tier);
