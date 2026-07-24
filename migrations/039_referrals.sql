-- ============================================================
-- Migration 039 — Pwogram Parennaj (Referral Program)
-- ============================================================
-- ⚠️ POUKISA: app mobil la (RegisterScreen + ReferralScreen) te DEJA
-- gen tout entèfas parennaj la — li voye yon `referralCode` lè yon moun
-- enskri, epi li rele `GET /api/referrals/dashboard`. MEN backend la pa
-- t gen ANYEN: ni kolòn, ni wout, ni lojik. Se poutèt sa pwogram nan
-- "pa fonksyone" — front lan t ap pale ak yon wout ki pa egziste (404).
--
-- Migration sa a ajoute:
--   1. `referral_code`  — kòd inik chak itilizatè pataje (jenere otomatik)
--   2. `referred_by`    — ki itilizatè ki te envite moun sa a
--   3. tab `referral_rewards` — chak rekonpans peye (trasabilite konplè)
--
-- Idanpotan: relanse l otan fwa ou vle.

-- ── 1. Kolòn sou users ──────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by   UUID REFERENCES users(id) ON DELETE SET NULL;

-- Kòd la dwe inik (yon sèl moun pa kòd). Endèks inik pasyèl: iyore NULL.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code
  ON users(referral_code) WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

-- ── 2. Bay yon kòd parennaj bay chak itilizatè ki poko genyen ──
-- Kòd la baze sou 8 premye karaktè yon UUID (san tirè), an MAJISKIL.
-- Sa garanti inisite san bezwen yon boukl retente.
UPDATE users
   SET referral_code = UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 8))
 WHERE referral_code IS NULL;

-- ── 3. Tab rekonpans ────────────────────────────────────────
-- Chak liy = yon rekonpans ki DWE (oswa deja) peye bay yon parennè
-- paske yon fiye li fè yon aksyon (egz. kreye premye kat li).
CREATE TABLE IF NOT EXISTS referral_rewards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- parennè a (moun ki resevwa lajan)
  referee_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- fiye a (moun ki te envite)
  reason        TEXT NOT NULL DEFAULT 'card_created',                  -- poukisa rekonpans lan
  amount_cents  INTEGER NOT NULL DEFAULT 50,                           -- $0.50 pa defo
  status        TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('pending','paid','failed')),
  created_at    TIMESTAMPTZ DEFAULT now(),

  -- Yon sèl rekonpans pa (parennè, fiye, rezon) — anpeche doub peman.
  UNIQUE (referrer_id, referee_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer ON referral_rewards(referrer_id);
