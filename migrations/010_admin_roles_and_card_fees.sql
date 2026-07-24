-- ============================================================
-- Migration 010: Sistèm wòl Admin (RBAC)
-- ============================================================
-- Elaji 'role' pou sipòte plizyè kalite anplwaye:
--   admin          → aksè total, eksepte jesyon lòt admin yo
--   super_admin    → aksè total + ka kreye/modifye/retire lòt admin
--   comptable      → finans: transaksyon, frè, rapò
--   service_client → sipò kliyan: konsilte itilizatè, KYC, notifikasyon

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('user', 'admin', 'super_admin', 'comptable', 'service_client'));

-- Ki admin ki te kreye kont sa a (odit)
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by_admin_id UUID REFERENCES users(id);
COMMENT ON COLUMN users.created_by_admin_id IS 'Admin ki kreye kont sa a (pou kont admin/staff)';

-- ============================================================
-- Table pou frè kat (kreyasyon, rechaj, elt) — kounye a modifyab
-- ============================================================
CREATE TABLE IF NOT EXISTS card_fees (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   TEXT NOT NULL UNIQUE,
  label                 TEXT NOT NULL,
  amount_cents          INTEGER,
  percent_bps           INTEGER,
  min_cents             INTEGER,
  max_cents             INTEGER,
  updated_by_admin_id   UUID REFERENCES users(id),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT now()
);

INSERT INTO card_fees (key, label, amount_cents) VALUES
  ('card_creation_debit',     'Émission carte Débit International',     520),
  ('card_creation_tokenized', 'Émission carte Tokenized (Apple/Google Pay)', 1200),
  ('bank_account_opening',    'Ouverture compte bancaire US',           1200),
  ('card_reload_tier1',       'Rechargement carte $3–$100',             100),
  ('card_reload_tier2',       'Rechargement carte $100.01–$500',        200),
  ('card_txn_success',        'Transaction carte réussie',              50),
  ('card_txn_declined',       'Transaction carte refusée',              40),
  ('late_reactivation',       'Pénalité réactivation tardive',          500)
ON CONFLICT (key) DO NOTHING;

INSERT INTO card_fees (key, label, percent_bps, min_cents) VALUES
  ('p2p_transfer',  'Transfert P2P',    50,  1),
  ('withdrawal',    'Retrait wallet',   500, 100)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE card_fees IS 'Frè kat/wallet modifyab pa admin/comptable — remplace valè ki te hardcode nan fees.config.ts';
