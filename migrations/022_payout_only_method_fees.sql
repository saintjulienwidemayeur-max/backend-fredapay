-- ============================================================
-- Migration 022: Konplete `payment_fees` ak metòd RETRÈ (payout) yo
-- ============================================================
-- ✅ FIX: `payment_fees` te DEJA matche PAYIN_METHODS (depo) 20 metòd yo
-- egzakteman — men PAYOUT_METHODS (retrè) nan frontend lan gen 5 metòd
-- SIPLEMANTÈ ki pa t janm gen yon ranje `payment_fees`: Ghana (MTN,
-- Airtel/Tigo, Vodafone), Virement USD (ACH/SWIFT), ak EFT Afrique du Sud.
-- San yon ranje, retrè sa yo te sèvi ak ranje "_default" la — kidonk admin
-- pa t ka wè ni ajiste frè yo apa. Nou ajoute yo isit la, menm règ ki nan
-- migration 007 la ($1.00 + 3.5%, sof si w chanje yo nan Dashboard la).
--
-- ✅ NÒT: Cameroun ak Côte d'Ivoire gen 2 non DIFERAN pou MENM operatè a
-- selon si se depo (`mtn_cm`/`orange_cm`) oswa retrè (`mtn_xaf`/`orange_xaf`,
-- `orange_ci`→`orange_xof`) — yon enkoyerans ki egziste deja nan config
-- frontend lan. Nou ajoute VARYAN retrè yo tou pou admin ka jere yo, san
-- nou pa chanje non ki deja itilize yo (sa ta yon pi gwo chanjman apa).

INSERT INTO payment_fees (method_id, method_name, currency, provider, deposit_flat_usd, deposit_pct, deposit_min_usd, withdraw_flat_usd, withdraw_pct, withdraw_min_usd, deposit_time, withdraw_time)
VALUES
  -- ── Ghana — retrè sèlman (Maplerad pa sipòte depo GHS) ──────
  ('mtn_gh',      'MTN MoMo Ghana',     'GHS', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('airtel_gh',   'Airtel Tigo Ghana',  'GHS', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('vodafone_gh', 'Vodafone Ghana',     'GHS', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Kamewoun / Kot Divwa — varyan non pou retrè ─────────────
  ('mtn_xaf',     'MTN Cameroun (retrè)',    'XAF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('orange_xaf',  'Orange Cameroun (retrè)', 'XAF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('mtn_xof',     'MTN Côte d''Ivoire (retrè)',    'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),
  ('orange_xof',  'Orange Côte d''Ivoire (retrè)', 'XOF', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Kenya — non altènatif itilize pa retrè a ────────────────
  ('safaricom_ke', 'Safaricom M-PESA (retrè)', 'KES', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── Afrik di Sid — EFT (retrè sèlman) ────────────────────────
  ('eft_za',      'Instant EFT (Afrique du Sud)', 'ZAR', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-24h'),

  -- ── USD — Virman entènasyonal (retrè sèlman) ─────────────────
  ('bank_usd',    'Virement USD (ACH/SWIFT)', 'USD', 'maplerad', 1.00, 3.50, 1.00, 1.00, 3.50, 1.00, 'Instantané', '1-3 jours')

ON CONFLICT (method_id) DO NOTHING;
