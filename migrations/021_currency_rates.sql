-- ============================================================
-- Migration 021: Taux chanj deviz — modifyab pa admin
-- ============================================================
-- ✅ FIX: `usdRate` pou chak deviz (NGN, KES, XAF, XOF, HTG, elt) te
-- KODE AN DIR nan `src/config/paymentMethods.ts` (frontend) — okenn
-- fason pou admin chanje yo san yon nouvo deplwaman kòd. Kounye a yo
-- viv nan DB la, admin ka modifye yo nan Dashboard la, e app kliyan an
-- chaje yo an dirèk.

CREATE TABLE IF NOT EXISTS currency_rates (
  currency            TEXT PRIMARY KEY,     -- 'NGN', 'KES', 'HTG', 'USD', elt
  usd_rate            NUMERIC(12,4) NOT NULL, -- konbyen 1 USD vo nan deviz sa a
  updated_by_admin_id UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE currency_rates IS 'Taux chanj (1 USD = X deviz) — modifyab pa admin, itilize pou konvèsyon afichaj.';

-- Valè inisyal yo — menm valè ki te kode an dir nan frontend la anvan.
INSERT INTO currency_rates (currency, usd_rate) VALUES
  ('NGN', 1600),
  ('KES', 130),
  ('GHS', 15),
  ('ZAR', 18),
  ('XAF', 620),
  ('XOF', 620),
  ('EGP', 49),
  ('TZS', 2600),
  ('UGX', 3700),
  ('HTG', 135),
  ('USD', 1)
ON CONFLICT (currency) DO NOTHING;
