-- ============================================================
-- Migration 003 — Freda Pay
-- Tablo: subscriptions + transactions_ledger
-- Kole nan: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── TABLE: subscriptions ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Plan
  plan                     TEXT NOT NULL DEFAULT 'trial',
  status                   TEXT NOT NULL DEFAULT 'trial',
  price_cents              INTEGER NOT NULL DEFAULT 0,

  -- Périodes
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  trial_ends_at            TIMESTAMPTZ,
  grace_started_at         TIMESTAMPTZ,
  locked_at                TIMESTAMPTZ,
  cancelled_at             TIMESTAMPTZ,

  -- Pénalités
  penalty_applied          BOOLEAN DEFAULT FALSE,
  penalty_amount_cents     INTEGER DEFAULT 0,
  penalty_applied_at       TIMESTAMPTZ,
  debt_cents               INTEGER NOT NULL DEFAULT 0,
  dunning_emails_sent      INTEGER NOT NULL DEFAULT 0,
  last_dunning_at          TIMESTAMPTZ,

  -- Limites du plan
  max_cards                INTEGER NOT NULL DEFAULT 1,
  monthly_limit_cents      INTEGER NOT NULL DEFAULT 50000,
  fredai_messages_limit    INTEGER NOT NULL DEFAULT 20,
  free_cards_included      INTEGER NOT NULL DEFAULT 0,
  includes_bank_account    BOOLEAN DEFAULT FALSE,

  -- Utilisation
  cards_created_this_month INTEGER NOT NULL DEFAULT 0,
  monthly_volume_cents     INTEGER NOT NULL DEFAULT 0,
  fredai_messages_used     INTEGER NOT NULL DEFAULT 0,
  usage_reset_at           TIMESTAMPTZ DEFAULT NOW(),

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT subscriptions_user_id_key UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status  ON subscriptions(status);

-- ── TABLE: transactions_ledger ───────────────────────────────
CREATE TABLE IF NOT EXISTS transactions_ledger (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_id         TEXT UNIQUE NOT NULL,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  from_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  card_id        TEXT,

  -- FreddaTag
  from_freda_tag TEXT,
  to_freda_tag   TEXT,

  -- Type & statut
  type           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  direction      TEXT NOT NULL DEFAULT 'debit',

  -- Montants (en cents)
  gross_amount   INTEGER NOT NULL DEFAULT 0,
  fee_amount     INTEGER NOT NULL DEFAULT 0,
  net_amount     INTEGER NOT NULL DEFAULT 0,
  currency       TEXT NOT NULL DEFAULT 'USD',

  -- Détails
  description    TEXT,
  note           TEXT,
  payment_method TEXT,
  external_ref   TEXT,
  failure_reason TEXT,

  -- Dates
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_id      ON transactions_ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_from_user    ON transactions_ledger(from_user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_to_user      ON transactions_ledger(to_user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type         ON transactions_ledger(type);
CREATE INDEX IF NOT EXISTS idx_ledger_status       ON transactions_ledger(status);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at   ON transactions_ledger(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_txn_id       ON transactions_ledger(txn_id);

-- ── Trigger auto updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subscriptions_updated_at ON subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS ledger_updated_at ON transactions_ledger;
CREATE TRIGGER ledger_updated_at
  BEFORE UPDATE ON transactions_ledger
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Ajoute kolòn mankan nan wallets si pa la ─────────────────
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'USD';
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS pending_balance INTEGER DEFAULT 0;

-- ── Verifye tablo kreye ───────────────────────────────────────
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_name = t.table_name AND table_schema = 'public') AS nb_colonnes
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('subscriptions', 'transactions_ledger', 'wallets', 'users')
ORDER BY table_name;
