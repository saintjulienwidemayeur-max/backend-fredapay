-- ============================================================
-- 037 — FRÈ PA PALYE (tiers) + nouvo pri rechaj kat tokenize
-- ============================================================
-- 📍 KOTE POU KOLE: Supabase → SQL Editor → New query → Run
-- ⚠️ Fè migration 036 la pase AVAN sa a.
--
-- POUKISA:
--   Tab `fee_rules` (036) te sipòte yon SÈL fòmil pa frè:
--   `flat + poursantaj`. Men rechaj kat tokenize a mande DE fòmil
--   diferan selon montan an:
--        1 $ – 100 $  → 2,79 $ FIKS
--      100 $ – 500 $  → 5 %
--
--   Sa a se yon estrikti PA PALYE. Nou ajoute yon tab `fee_rule_tiers`
--   ki mache pou NENPÒT frè — konsa pwochèn fwa w vle yon pri pa palye
--   (transfè P2P, retrè...) ou pa bezwen okenn kòd nouvo.

-- ── TAB PALYE YO ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fee_rule_tiers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Kle règ la nan `fee_rules`
  rule_key      TEXT NOT NULL REFERENCES fee_rules(rule_key) ON DELETE CASCADE,
  -- Rang montan an, an SANTIM. Bòn yo ENKLIZIF.
  min_cents     BIGINT NOT NULL,
  -- 0 = pa gen limit anwo (dènye palye a)
  max_cents     BIGINT NOT NULL DEFAULT 0,
  -- Fòmil palye sa a: flat + (montan × bps / 10000)
  flat_cents    BIGINT NOT NULL DEFAULT 0,
  percent_bps   INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Yon sèl palye pa rang pa règ
  UNIQUE (rule_key, min_cents)
);

CREATE INDEX IF NOT EXISTS idx_fee_rule_tiers_lookup
  ON fee_rule_tiers (rule_key, min_cents) WHERE is_active = TRUE;

COMMENT ON TABLE  fee_rule_tiers IS 'Frè pa palye. Si yon rule_key gen palye isit la, yo pran priyorite sou fòmil senp `fee_rules` la.';
COMMENT ON COLUMN fee_rule_tiers.max_cents IS '0 = pa gen limit anwo';


-- ── NOUVO RÈG: rechaj kat TOKENIZE ──────────────────────────
INSERT INTO fee_rules (rule_key, label, flat_cents, percent_bps, min_cents, max_cents, description) VALUES
  ('card_reload_tokenized', 'Frais recharge carte tokenisée', 0, 0, 0, 0,
   'Rechaj yon kat tokenize (Apple/Google Pay). Pri a PA PALYE — wè fee_rule_tiers.'),
  ('card_reload_standard',  'Frais recharge carte',            0, 0, 0, 0,
   'Rechaj yon kat debi klasik. Pri a PA PALYE — wè fee_rule_tiers.')
ON CONFLICT (rule_key) DO UPDATE SET
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  updated_at  = NOW();


-- ── PALYE YO ────────────────────────────────────────────────
-- 🔴 KAT TOKENIZE (nouvo pri a)
--    1,00 $ – 100,00 $ → 2,79 $ fiks
--  100,01 $ – 500,00 $ → 5 %
--
-- ⚠️ NÒT SOU BÒN YO: ou te di « 101 à 500 ». Mwen mete dezyèm palye a
--    kòmanse a 100,01 $ epi pa a 101,00 $ — sinon yon rechaj de 100,50 $
--    pa ta antre nan OKENN palye epi li ta echwe. Si w vle vre yon twou
--    ant 100 $ ak 101 $, chanje `min_cents` la a 10100.
INSERT INTO fee_rule_tiers (rule_key, min_cents, max_cents, flat_cents, percent_bps) VALUES
  ('card_reload_tokenized',   100,  10000, 279,   0),   -- 1 $ – 100 $   → 2,79 $
  ('card_reload_tokenized', 10001,  50000,   0, 500)    -- 100,01 $ – 500 $ → 5 %
ON CONFLICT (rule_key, min_cents) DO UPDATE SET
  max_cents   = EXCLUDED.max_cents,
  flat_cents  = EXCLUDED.flat_cents,
  percent_bps = EXCLUDED.percent_bps,
  is_active   = TRUE,
  updated_at  = NOW();

-- ⚪ KAT DEBI KLASIK — MENM PRI AK AVAN (okenn chanjman pou kliyan yo)
--    Valè sa yo se yon MIWA de `card_fees.card_reload_tier1/tier2`.
--    Yo sèvi kòm sekou si tab `card_fees` la pa reponn.
INSERT INTO fee_rule_tiers (rule_key, min_cents, max_cents, flat_cents, percent_bps) VALUES
  ('card_reload_standard',   100,  10000, 120,   0),   -- 1 $ – 100 $   → 1,20 $
  ('card_reload_standard', 10001,  50000,   0, 250)    -- 100,01 $ – 500 $ → 2,5 %
ON CONFLICT (rule_key, min_cents) DO UPDATE SET
  max_cents   = EXCLUDED.max_cents,
  flat_cents  = EXCLUDED.flat_cents,
  percent_bps = EXCLUDED.percent_bps,
  is_active   = TRUE,
  updated_at  = NOW();


-- ── VERIFIKASYON ────────────────────────────────────────────
-- Ou dwe wè 4 liy. Kolòn `egzanp` montre frè a pou yon rechaj tès.
SELECT
  t.rule_key,
  (t.min_cents / 100.0) || ' $ – ' ||
    CASE WHEN t.max_cents = 0 THEN '∞' ELSE (t.max_cents / 100.0)::TEXT || ' $' END AS rang,
  (t.flat_cents / 100.0)  AS fiks_dola,
  (t.percent_bps / 100.0) AS pousan,
  -- Egzanp: konbyen yon rechaj de 50 $ ak yon de 300 $ ta koute
  CASE WHEN 5000 BETWEEN t.min_cents AND COALESCE(NULLIF(t.max_cents,0), 999999999)
       THEN ((t.flat_cents + (5000 * t.percent_bps / 10000)) / 100.0)::TEXT || ' $ pou 50 $'
       ELSE '—' END AS egzanp_50,
  CASE WHEN 30000 BETWEEN t.min_cents AND COALESCE(NULLIF(t.max_cents,0), 999999999)
       THEN ((t.flat_cents + (30000 * t.percent_bps / 10000)) / 100.0)::TEXT || ' $ pou 300 $'
       ELSE '—' END AS egzanp_300
FROM fee_rule_tiers t
WHERE t.is_active
ORDER BY t.rule_key, t.min_cents;
