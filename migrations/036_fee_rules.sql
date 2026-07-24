-- ============================================================
-- 036 — TOUT FRÈ YO NAN DB (fee_rules)
-- ============================================================
-- 📍 KOTE POU KOLE: Supabase → SQL Editor → New query → Run
--
-- PWOBLÈM NOU KORIJE:
--   Frè yo te separe an DE kote:
--     ✅ `payment_fees` (DB)  → frè depo/retrè PA METÒD (MonCash, elt.)
--     ❌ `fees.config.ts`     → TOUT LÒT frè yo, AN DUR nan kòd la:
--                               • Transfè P2P (0.5%)
--                               • Emisyon kat ($5.20)
--                               • Kat tokenize ($12.00)
--                               • Txn kat reyisi ($0.50) / refize ($0.40)
--                               • Ouvèti kont bankè US ($12.00)
--                               • Reyaktivasyon tadi ($5.00)
--
--   Rezilta: pou chanje frè P2P la ou te oblije redeplwaye backend la.
--   Epi kèk tranzaksyon pa t janm gen frè aplike ditou.
--
-- ✅ KOUNYE A: yon sèl tab `fee_rules` pou TOUT frè yo. Chanje yon valè
--    nan Supabase → li aktif nan 5 minit (kachèt la) san redeplwaman.
--
-- ⚠️ `payment_fees` RETE jan li ye — li gen frè pa metòd (MonCash vs
--    NatCash vs Kashpaw). `fee_rules` konplete l pou tout rès la.

-- ── TAB LA ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kle teknik ki idantifye règ la nan kòd la. PA CHANJE YO.
  rule_key     TEXT NOT NULL UNIQUE,
  -- Tèks ki parèt nan detay tranzaksyon an sou telefòn nan.
  label        TEXT NOT NULL,
  -- Pati fiks la, an SANTIM ($1.50 → 150)
  flat_cents   BIGINT NOT NULL DEFAULT 0,
  -- Pati poursantaj la an BPS (base points). 5% → 500. 0.5% → 50.
  percent_bps  INTEGER NOT NULL DEFAULT 0,
  -- Planche/plafon an santim. max_cents = 0 vle di PA GEN plafon.
  min_cents    BIGINT NOT NULL DEFAULT 0,
  max_cents    BIGINT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_active
  ON fee_rules (rule_key) WHERE is_active = TRUE;

COMMENT ON TABLE  fee_rules IS 'Tout frè Freda Pay yo. Chanje yon valè isit la → aktif nan 5 min san redeplwaman.';
COMMENT ON COLUMN fee_rules.percent_bps IS 'Base points: 500 = 5%, 50 = 0.5%, 350 = 3.5%';
COMMENT ON COLUMN fee_rules.max_cents   IS '0 = pa gen plafon';

-- ── VALÈ YO (menm ak sa ki te an dur nan fees.config.ts) ────
INSERT INTO fee_rules (rule_key, label, flat_cents, percent_bps, min_cents, max_cents, description) VALUES
  ('p2p_transfer',        'Frais transfert (0,5 %)',        0,   50,   1,   0, 'Transfè ant de itilizatè Freda Pay'),
  ('wallet_deposit',      'Frais dépôt (1,50 $ + 5 %)',   150,  500,   0,   0, 'Depo wallet — fallback si metòd la pa nan payment_fees'),
  ('wallet_withdrawal',   'Frais retrait (5 %, min 1 $)',   0,  500, 100,   0, 'Retrè wallet — fallback si metòd la pa nan payment_fees'),
  ('card_creation',       'Émission carte',               520,    0,   0,   0, 'Kreyasyon yon kat vityèl'),
  ('card_creation_token', 'Émission carte tokenisée',    1200,    0,   0,   0, 'Kat ki konpatib Google Pay / Apple Pay'),
  ('card_reload',         'Frais recharge carte',           0,  200,  50,   0, 'Rechaj yon kat vityèl'),
  ('card_txn_success',    'Frais transaction carte',       50,    0,   0,   0, 'Chak acha reyisi sou yon kat'),
  ('card_txn_declined',   'Frais transaction refusée',     40,    0,   0,   0, 'Chak acha refize sou yon kat'),
  ('bank_account_open',   'Ouverture compte bancaire US', 1200,    0,   0,   0, 'Ouvèti yon kont bankè ameriken'),
  ('late_reactivation',   'Réactivation tardive',         500,    0,   0,   0, 'Reyaktivasyon apre 15 jou reta'),
  ('nsf_penalty',         'Pénalité solde insuffisant',   500,    0,   0,   0, 'Balans pa sifi pou yon prelèvman otomatik')
ON CONFLICT (rule_key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  updated_at  = NOW();
-- ☝️ `DO UPDATE` mete ajou SÈLMAN tèks yo. Valè lajan yo PA touche —
--    konsa si w deja ajiste yon pri nan Supabase, relanse fichye sa a
--    p ap efase chanjman w lan.

-- ── KOLÒN `fee_label` SOU TRANZAKSYON YO ────────────────────
-- Konsa detay tranzaksyon an ka montre KI frè ki te aplike, ak tèks
-- egzak ki te anvigè NAN MOMAN AN — menm si w chanje pri a demen.
-- (Se yon "istorik fig": yon resi ki gen 6 mwa dwe toujou montre frè ki
--  te aplike lè sa a, pa frè jodi a.)
ALTER TABLE transactions_ledger
  ADD COLUMN IF NOT EXISTS fee_label TEXT;

COMMENT ON COLUMN transactions_ledger.fee_label IS
  'Tèks frè a jan li te ye lè tranzaksyon an fèt (istorik fig). Soti nan fee_rules.label.';

-- Menm bagay sou `transfers` si tab la egziste nan enstalasyon w lan.
ALTER TABLE transfers
  ADD COLUMN IF NOT EXISTS fee_label TEXT;

-- ── VERIFIKASYON ────────────────────────────────────────────
SELECT rule_key, label,
       (flat_cents / 100.0) AS fiks_dola,
       (percent_bps / 100.0) AS pousan,
       (min_cents / 100.0) AS minimòm_dola,
       is_active
  FROM fee_rules
 ORDER BY rule_key;
