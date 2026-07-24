-- ============================================================
-- 038 — TOUT PRI KAT YO (klasik + tokenize) — FICHYE KONPLÈ
-- v2 — chak deklarasyon 100% OTONÒM (pa gen tab pataje)
-- ============================================================
-- 📍 KOTE POU KOLE: Supabase → SQL Editor → New query → Run
--
-- ⚠️ POUKISA v2: vèsyon anvan an te itilize yon tab entèmedyè (_pri,
--    _bòn) pou pase menm chif yo bay 3 deklarasyon diferan. Sa te lakòz
--    yon erè "relation does not exist" — kèlkeswa si tab la te tanporè
--    oswa pèmanan. Nou pa ka konfime ak 100% sètitid mekanis egzat ki
--    lakòz sa (Supabase SQL Editor ka egzekite chak deklarasyon nan yon
--    fason ki pa toujou kenbe menm eta ant yo), men olye nou kontinye
--    eseye devine kòz la, nou ELIMINE depandans lan NÈT: CHAK
--    deklarasyon anba a se yon SÈL kòmand SQL ki pote pwòp chif li
--    ladan l, san li bezwen li anyen yon lòt deklarasyon te kreye. Yon
--    kòmand SQL pa ka janm "pèdi" yon bagay ki fè pati de menm kòmand
--    lan — donk apwòch sa a mache kèlkeswa fason Supabase egzekite l.
--
-- ⚠️ KONSEKANS: chif pri yo parèt PLIZYÈ FWA nan fichye sa a (yon fwa
--    pou chak tab). Sa se yon script SETUP inisyal — pa yon zouti pou
--    relanse regilyèman. Pou CHANJE yon pri APRE jodi a, pa modifye
--    fichye sa a: sèvi ak yon senp UPDATE dirèk (egzanp nan FRE_YO.md).
--
-- SA FICHYE SA A FÈ — mete MENM pri a nan TWA tab:
--   • `card_fees`      → emisyon kat, frè tranzaksyon (SOUS VERITE
--                        REYÈL pou kalkil yo — kòd la li isit la)
--   • `fee_rules`      → etikèt/rezime pou API `/api/fees/rules`
--   • `fee_rule_tiers` → palye rechaj yo (SOUS VERITE REYÈL pou rechaj)
--
-- Li IDANPOTAN — relanse l otan fwa ou vle.
-- ============================================================


-- ┌────────────────────────────────────────────────────────────┐
-- │  GRI PRI (referans — chif yo reyèlman nan seksyon anba a)  │
-- ├────────────────────────────────────────────────────────────┤
-- │  Émission carte débit classique .......... 5,20 $          │
-- │  Émission carte tokenisée ................ 12,00 $         │
-- │  Recharge débit    1 $ – 100 $ ........... 1,20 $ fixe      │
-- │  Recharge débit    100,01 $ – 500 $ ...... 2,5 %            │
-- │  Recharge tokenisée 1 $ – 100 $ .......... 2,79 $ fixe      │
-- │  Recharge tokenisée 100,01 $ – 500 $ ..... 5 %               │
-- │  Transaction carte réussie ............... 0,50 $           │
-- │  Transaction carte refusée ............... 0,40 $           │
-- └────────────────────────────────────────────────────────────┘


-- ── 0. Kreye tab yo si yo pa la (endepandan de 036/037) ─────
CREATE TABLE IF NOT EXISTS fee_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key     TEXT NOT NULL UNIQUE,
  label        TEXT NOT NULL,
  flat_cents   BIGINT NOT NULL DEFAULT 0,
  percent_bps  INTEGER NOT NULL DEFAULT 0,
  min_cents    BIGINT NOT NULL DEFAULT 0,
  max_cents    BIGINT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  description  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fee_rule_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key      TEXT NOT NULL REFERENCES fee_rules(rule_key) ON DELETE CASCADE,
  min_cents     BIGINT NOT NULL,
  max_cents     BIGINT NOT NULL DEFAULT 0,
  flat_cents    BIGINT NOT NULL DEFAULT 0,
  percent_bps   INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rule_key, min_cents)
);

CREATE INDEX IF NOT EXISTS idx_fee_rules_active
  ON fee_rules (rule_key) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_fee_rule_tiers_lookup
  ON fee_rule_tiers (rule_key, min_cents) WHERE is_active = TRUE;


-- ── 1. `card_fees` — emisyon + frè tranzaksyon ──────────────
-- ✅ v2: yon senp `INSERT ... VALUES` — Postgres konnen tip chak kolòn
-- DIREKTEMAN depi lis kolòn `INSERT INTO card_fees (...)` la, donk yon
-- `NULL` literal antre san okenn kaste ak san okenn anbigwite (kontrèman
-- ak yon `UNION ALL` de plizyè `SELECT`, kote Postgres dwe DEVINE yon
-- tip pataje pou chak branch — se la ansyen erè "NULL est de type text"
-- la te soti).
INSERT INTO card_fees (key, label, amount_cents, percent_bps) VALUES
  ('card_creation_debit',     'Émission carte Débit International',          520, NULL),
  ('card_creation_tokenized', 'Émission carte tokenisée (Apple/Google Pay)', 1200, NULL),
  ('card_txn_success',        'Transaction carte réussie',                    50, NULL),
  ('card_txn_declined',       'Transaction carte refusée',                    40, NULL)
ON CONFLICT (key) DO UPDATE SET
  label        = EXCLUDED.label,
  amount_cents = EXCLUDED.amount_cents,
  updated_at   = NOW();

-- Ansyen kle rechaj yo (migration 010) — nou sinkronize yo pou panèl
-- admin lan pa montre yon pri ki pa vre ankò. (Kòd la li `fee_rule_tiers`
-- pou kalkil rechaj yo — kolòn sa yo se afichaj sèlman.)
UPDATE card_fees SET
  label        = 'Rechargement carte débit $1–$100',
  amount_cents = 120,
  percent_bps  = NULL,
  updated_at   = NOW()
WHERE key = 'card_reload_tier1';

UPDATE card_fees SET
  label        = 'Rechargement carte débit $100.01–$500',
  amount_cents = NULL,
  percent_bps  = 250,
  updated_at   = NOW()
WHERE key = 'card_reload_tier2';


-- ── 2. `fee_rules` — etikèt yo (pou API /api/fees/rules) ────
INSERT INTO fee_rules (rule_key, label, flat_cents, percent_bps, min_cents, max_cents, description) VALUES
  ('card_reload_standard',  'Frais recharge carte',             0,   0, 0, 0, 'Rechaj kat debi klasik — pri pa palye, wè fee_rule_tiers'),
  ('card_reload_tokenized', 'Frais recharge carte tokenisée',   0,   0, 0, 0, 'Rechaj kat tokenize — pri pa palye, wè fee_rule_tiers'),
  ('card_creation',         'Émission carte',                 520,   0, 0, 0, 'Kreyasyon yon kat vityèl debi'),
  ('card_creation_token',   'Émission carte tokenisée',      1200,   0, 0, 0, 'Kat ki konpatib Google Pay / Apple Pay'),
  ('card_txn_success',      'Frais transaction carte',         50,   0, 0, 0, 'Chak acha reyisi sou yon kat'),
  ('card_txn_declined',     'Frais transaction refusée',       40,   0, 0, 0, 'Chak acha refize sou yon kat')
ON CONFLICT (rule_key) DO UPDATE SET
  label       = EXCLUDED.label,
  flat_cents  = EXCLUDED.flat_cents,
  percent_bps = EXCLUDED.percent_bps,
  updated_at  = NOW();


-- ── 3. `fee_rule_tiers` — palye rechaj yo (SOUS VERITE la) ──
-- ⚠️ Dezyèm palye a kòmanse a 100,01 $ epi PA 101 $ — sinon yon rechaj
-- de 100,50 $ pa ta antre nan okenn palye epi li ta ECHWE.
INSERT INTO fee_rule_tiers (rule_key, min_cents, max_cents, flat_cents, percent_bps) VALUES
  ('card_reload_standard',    100, 10000,  120,   0),  -- Débit    : 1$–100$      → 1,20 $
  ('card_reload_standard',  10001, 50000,    0, 250),  -- Débit    : 100,01$–500$ → 2,5 %
  ('card_reload_tokenized',   100, 10000,  279,   0),  -- Tokenisée: 1$–100$      → 2,79 $
  ('card_reload_tokenized', 10001, 50000,    0, 500)   -- Tokenisée: 100,01$–500$ → 5 %
ON CONFLICT (rule_key, min_cents) DO UPDATE SET
  max_cents   = EXCLUDED.max_cents,
  flat_cents  = EXCLUDED.flat_cents,
  percent_bps = EXCLUDED.percent_bps,
  is_active   = TRUE,
  updated_at  = NOW();


-- ── 4. VERIFIKASYON OTOMATIK — echwe fò si gen dezakò ────────
-- Si yon dat pita yon moun modifye yon chif nan yon sèl kote (egzanp
-- `card_fees`) san mete lòt kote yo ajou, blòk sa a ap ARETE script la
-- ak yon mesaj klè — olye pou l kite yon dezakò pase san moun pa wè l.
DO $$
DECLARE
  v_card_creation_debit    INT;
  v_rule_card_creation     INT;
  v_card_creation_token    INT;
  v_rule_card_creation_tok INT;
  v_tier_std_p1            INT;
  v_tier_tok_p1             INT;
BEGIN
  SELECT amount_cents INTO v_card_creation_debit FROM card_fees WHERE key = 'card_creation_debit';
  SELECT flat_cents   INTO v_rule_card_creation   FROM fee_rules WHERE rule_key = 'card_creation';
  IF v_card_creation_debit IS DISTINCT FROM v_rule_card_creation THEN
    RAISE EXCEPTION 'DEZAKÒ: card_fees.card_creation_debit (%) != fee_rules.card_creation (%)',
      v_card_creation_debit, v_rule_card_creation;
  END IF;

  SELECT amount_cents INTO v_card_creation_token    FROM card_fees WHERE key = 'card_creation_tokenized';
  SELECT flat_cents   INTO v_rule_card_creation_tok  FROM fee_rules WHERE rule_key = 'card_creation_token';
  IF v_card_creation_token IS DISTINCT FROM v_rule_card_creation_tok THEN
    RAISE EXCEPTION 'DEZAKÒ: card_fees.card_creation_tokenized (%) != fee_rules.card_creation_token (%)',
      v_card_creation_token, v_rule_card_creation_tok;
  END IF;

  SELECT amount_cents INTO v_tier_std_p1 FROM card_fees WHERE key = 'card_reload_tier1';
  SELECT flat_cents   INTO v_tier_tok_p1 FROM fee_rule_tiers WHERE rule_key = 'card_reload_standard' AND min_cents = 100;
  IF v_tier_std_p1 IS DISTINCT FROM v_tier_tok_p1 THEN
    RAISE EXCEPTION 'DEZAKÒ: card_fees.card_reload_tier1 (%) != fee_rule_tiers premye palye débit (%)',
      v_tier_std_p1, v_tier_tok_p1;
  END IF;

  RAISE NOTICE '✅ Tout pri yo sinkronize ant card_fees, fee_rules ak fee_rule_tiers.';
END $$;


-- ── 5. Gri pri konplè — pou w tcheke ak je w ────────────────
-- Ou dwe wè 8 liy.
SELECT operasyon, kat, montan_rechaj, pri FROM (
  SELECT 1 AS ord, 0::BIGINT AS sub_ord, 'Émission' AS operasyon, 'Débit' AS kat,
         '—' AS montan_rechaj,
         (amount_cents / 100.0)::TEXT || ' $' AS pri
    FROM card_fees WHERE key = 'card_creation_debit'
  UNION ALL
  SELECT 2, 0::BIGINT, 'Émission', 'Tokenisée', '—',
         (amount_cents / 100.0)::TEXT || ' $'
    FROM card_fees WHERE key = 'card_creation_tokenized'
  UNION ALL
  SELECT 3, t.min_cents, 'Recharge',
         CASE WHEN t.rule_key = 'card_reload_tokenized' THEN 'Tokenisée' ELSE 'Débit' END,
         (t.min_cents / 100.0)::TEXT || ' $ – ' || (t.max_cents / 100.0)::TEXT || ' $',
         CASE
           WHEN t.percent_bps > 0
             THEN (t.percent_bps / 100.0)::TEXT || ' %'
                  || '  (ex. 300 $ → ' || ((30000 * t.percent_bps / 10000) / 100.0)::TEXT || ' $)'
           ELSE (t.flat_cents / 100.0)::TEXT || ' $ fixe'
         END
    FROM fee_rule_tiers t
   WHERE t.rule_key IN ('card_reload_standard', 'card_reload_tokenized')
     AND t.is_active
  UNION ALL
  SELECT 4, 0::BIGINT, 'Transaction réussie', 'Toutes', '—',
         (amount_cents / 100.0)::TEXT || ' $'
    FROM card_fees WHERE key = 'card_txn_success'
  UNION ALL
  SELECT 5, 0::BIGINT, 'Transaction refusée', 'Toutes', '—',
         (amount_cents / 100.0)::TEXT || ' $'
    FROM card_fees WHERE key = 'card_txn_declined'
) x
ORDER BY ord, kat DESC, sub_ord;
