-- ============================================================
-- Migration 029: Nouvo estrikti pri rechajman kat
-- ============================================================
-- ✅ FIX: nouvo pri kliyan an mande: $1–$100 → $1.20 fiks;
-- $101 e plis → 2.5% (pousantaj, PA yon montan fiks kòm anvan).

UPDATE card_fees SET
  label = 'Rechargement carte $1–$100',
  amount_cents = 120
WHERE key = 'card_reload_tier1';

UPDATE card_fees SET
  label = 'Rechargement carte $101+',
  amount_cents = NULL,
  percent_bps = 250
WHERE key = 'card_reload_tier2';
