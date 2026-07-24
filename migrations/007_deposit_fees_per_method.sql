-- ============================================================
-- Migration 007 — Frè Depo par Metòd
-- Règ: MonCash + NatCash = $1.00 + 5%
--      Tout lòt metòd    = $1.00 + 3.5%
-- Supabase Dashboard → SQL Editor → Kole epi ekzekite
-- ============================================================

-- Asire table existe
CREATE TABLE IF NOT EXISTS payment_fees (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  method_id        TEXT NOT NULL UNIQUE,
  method_name      TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'USD',
  provider         TEXT NOT NULL DEFAULT 'maplerad',
  deposit_flat_usd NUMERIC(10,4) NOT NULL DEFAULT 1.00,
  deposit_pct      NUMERIC(10,4) NOT NULL DEFAULT 3.50,
  deposit_min_usd  NUMERIC(10,4) NOT NULL DEFAULT 1.00,
  deposit_max_usd  NUMERIC(10,4) NOT NULL DEFAULT 0,
  withdraw_flat_usd NUMERIC(10,4) NOT NULL DEFAULT 1.00,
  withdraw_pct     NUMERIC(10,4) NOT NULL DEFAULT 3.50,
  withdraw_min_usd NUMERIC(10,4) NOT NULL DEFAULT 1.00,
  withdraw_max_usd NUMERIC(10,4) NOT NULL DEFAULT 0,
  deposit_time     TEXT NOT NULL DEFAULT 'Instantané',
  withdraw_time    TEXT NOT NULL DEFAULT '1-24h',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- Insérer ou mettre à jour tous les frais
INSERT INTO payment_fees (method_id, method_name, currency, provider, deposit_flat_usd, deposit_pct, deposit_min_usd, withdraw_flat_usd, withdraw_pct, withdraw_min_usd, deposit_time, withdraw_time)
VALUES
  -- ── Haïti — Pay'm ─────────────────────────────────────────
  -- MonCash: $1.00 + 5%
  ('moncash',   'MonCash',           'HTG', 'paym',    1.00, 5.00, 1.00, 1.00, 5.00, 1.00, 'Instantané', 'Instantané'),
  -- NatCash: $1.00 + 5%
  ('natcash',   'NatCash',           'HTG', 'paym',    1.00, 5.00, 1.00, 1.00, 5.00, 1.00, 'Instantané', 'Instantané'),
  -- KashPaw: $1.00 + 3.5%
  ('kashpaw',   'KashPaw',           'HTG', 'paym',    1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', 'Instantané'),

  -- ── Nigeria ──────────────────────────────────────────────
  ('ngn_bank',  'Bank Transfer NGN', 'NGN', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, '1-2 heures', '1-24h'),

  -- ── Kenya ────────────────────────────────────────────────
  ('mpesa_ke',  'M-PESA',            'KES', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('airtel_ke', 'Airtel Kenya',      'KES', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Cameroun ─────────────────────────────────────────────
  ('mtn_cm',    'MTN Cameroun',      'XAF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('orange_cm', 'Orange Cameroun',   'XAF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Côte d''Ivoire ────────────────────────────────────────
  ('mtn_ci',    'MTN Côte d''Ivoire','XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('orange_ci', 'Orange CI',         'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('moov_ci',   'Moov Money CI',     'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Bénin ────────────────────────────────────────────────
  ('mtn_bj',    'MTN Bénin',         'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('orange_bj', 'Orange Bénin',      'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('moov_bj',   'Moov Money Bénin',  'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('celtis_bj', 'Celtis Bénin',      'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Uganda ───────────────────────────────────────────────
  ('mtn_ug',    'MTN Uganda',        'UGX', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('airtel_ug', 'Airtel Uganda',     'UGX', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Tanzanie ─────────────────────────────────────────────
  ('tigo_tz',   'Tigo Pesa',         'TZS', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('airtel_tz', 'Airtel Tanzania',   'TZS', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('halo_tz',   'HaloPesa',          'TZS', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Défaut (fallback) ─────────────────────────────────────
  ('_default',  'Défaut',            'USD', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h')

ON CONFLICT (method_id) DO UPDATE SET
  deposit_flat_usd  = EXCLUDED.deposit_flat_usd,
  deposit_pct       = EXCLUDED.deposit_pct,
  deposit_min_usd   = EXCLUDED.deposit_min_usd,
  withdraw_flat_usd = EXCLUDED.withdraw_flat_usd,
  withdraw_pct      = EXCLUDED.withdraw_pct,
  withdraw_min_usd  = EXCLUDED.withdraw_min_usd,
  deposit_time      = EXCLUDED.deposit_time,
  withdraw_time     = EXCLUDED.withdraw_time,
  is_active         = true,
  updated_at        = now();

-- Vérifier résultat
SELECT method_id, method_name, deposit_flat_usd, deposit_pct, currency
FROM payment_fees
ORDER BY provider, currency, method_id;
