-- ============================================================
-- FREDA PAY — Schema PostgreSQL (Supabase)
-- Exécutez ce SQL dans: supabase.com/dashboard → SQL Editor
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email            TEXT UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  firstname        TEXT NOT NULL,
  lastname         TEXT NOT NULL,
  phone            TEXT,
  dial_code        TEXT,
  country          TEXT,
  city             TEXT,
  address          TEXT,
  date_of_birth    DATE,
  genre            TEXT CHECK (genre IN ('Homme', 'Femme', 'Autre')),
  freda_tag       TEXT UNIQUE NOT NULL,
  avatar_url       TEXT,
  role             TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'suspended', 'banned')),
  kyc_status       TEXT NOT NULL DEFAULT 'not_started' CHECK (kyc_status IN ('not_started', 'pending', 'approved', 'declined')),
  kyc_session_id   TEXT,
  email_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  phone_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  last_login_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── REFRESH TOKENS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── KYC SESSIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kyc_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  session_id          TEXT UNIQUE NOT NULL,
  session_url         TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Approved', 'Declined', 'In Review', 'Expired')),
  workflow_id         TEXT NOT NULL,
  verification_data   JSONB,
  completed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── WALLETS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wallets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency          TEXT NOT NULL DEFAULT 'USD',
  balance           BIGINT NOT NULL DEFAULT 0,        -- En centimes
  available_balance BIGINT NOT NULL DEFAULT 0,
  pending_balance   BIGINT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, currency)
);

-- ── TRANSFERS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transfers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  txn_id          TEXT UNIQUE NOT NULL,
  from_user_id    UUID REFERENCES users(id),
  to_user_id      UUID REFERENCES users(id),
  from_freda_tag TEXT,
  to_freda_tag   TEXT,
  type            TEXT NOT NULL CHECK (type IN ('send','receive','deposit','withdrawal','card_funding','card_refund','fee','conversion','request','ach','wire')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled','reversed')),
  amount          BIGINT NOT NULL,                   -- En centimes
  currency        TEXT NOT NULL DEFAULT 'USD',
  fee             BIGINT NOT NULL DEFAULT 0,
  total_amount    BIGINT NOT NULL,
  description     TEXT,
  note            TEXT,
  payment_method  TEXT,
  external_ref    TEXT,
  metadata        JSONB,
  failure_reason  TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CARDS (Pagocards) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cards (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cardid      TEXT UNIQUE NOT NULL,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  firstname   TEXT NOT NULL,
  lastname    TEXT NOT NULL,
  card_type   TEXT NOT NULL DEFAULT 'mastercard' CHECK (card_type IN ('mastercard', 'visa')),
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('active', 'blocked', 'pending')),
  balance     NUMERIC(12,2) NOT NULL DEFAULT 0,
  masked_pan  TEXT,
  expiry      TEXT,
  theme       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  data       JSONB,
  is_read    BOOLEAN NOT NULL DEFAULT FALSE,
  priority   TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── WEBHOOK EVENTS ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id      TEXT UNIQUE NOT NULL,
  event_name    TEXT NOT NULL,
  card_id       TEXT,
  source        TEXT NOT NULL DEFAULT 'pagocards' CHECK (source IN ('pagocards', 'didit')),
  status        TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processed', 'failed', 'duplicate')),
  payload       JSONB NOT NULL,
  error_message TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ
);

-- ── CARD TRANSACTIONS (Pagocards) ────────────────────────────
CREATE TABLE IF NOT EXISTS card_transactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  txn_id         TEXT UNIQUE NOT NULL,
  cardid         TEXT NOT NULL,
  user_id        UUID REFERENCES users(id),
  event_id       TEXT NOT NULL,
  event_name     TEXT NOT NULL,
  merchant_name  TEXT,
  amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',
  status         TEXT NOT NULL DEFAULT 'pending',
  raw_payload    JSONB,
  processed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── INDEX ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email        ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_freda_tag   ON users(freda_tag);
CREATE INDEX IF NOT EXISTS idx_users_phone        ON users(phone);
CREATE INDEX IF NOT EXISTS idx_transfers_from     ON transfers(from_user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to       ON transfers(to_user_id);
CREATE INDEX IF NOT EXISTS idx_transfers_txn_id   ON transfers(txn_id);
CREATE INDEX IF NOT EXISTS idx_notifs_user        ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_cards_user         ON cards(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_user           ON kyc_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_webhook_event_id   ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_user         ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user       ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_card_txn_cardid    ON card_transactions(cardid);

-- ── ROW LEVEL SECURITY ────────────────────────────────────────
-- Active RLS sur toutes les tables sensibles
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets            ENABLE ROW LEVEL SECURITY;
ALTER TABLE transfers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE kyc_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cards              ENABLE ROW LEVEL SECURITY;

-- Politiques: le backend utilise service_role → accès complet
-- Le frontend (si jamais) ne peut voir que ses propres données

-- ── TRIGGER updated_at automatique ───────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'set_updated_at_users';
  IF NOT FOUND THEN
    CREATE TRIGGER set_updated_at_users BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'set_updated_at_wallets';
  IF NOT FOUND THEN
    CREATE TRIGGER set_updated_at_wallets BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'set_updated_at_transfers';
  IF NOT FOUND THEN
    CREATE TRIGGER set_updated_at_transfers BEFORE UPDATE ON transfers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'set_updated_at_cards';
  IF NOT FOUND THEN
    CREATE TRIGGER set_updated_at_cards BEFORE UPDATE ON cards FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

DO $$ BEGIN
  PERFORM 1 FROM pg_trigger WHERE tgname = 'set_updated_at_kyc';
  IF NOT FOUND THEN
    CREATE TRIGGER set_updated_at_kyc BEFORE UPDATE ON kyc_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
