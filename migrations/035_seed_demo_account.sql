-- ============================================================
-- 035 — KONT DEMO: TOUT BAGAY NAN YON SÈL FICHYE
-- ============================================================
-- 📍 KOTE POU KOLE SA A:
--    Supabase Dashboard → pwojè w la → SQL Editor → New query
--    → kole tout fichye sa a → klike "Run"
--
--    Ou PA bezwen `psql`. Ou PA bezwen `npm run seed:demo`.
--    Fichye sa a ranplase migration 034 LA A ak script seed la.
--
-- Li IDANPOTAN — ou ka relanse l otan fwa ou vle san danje.
--
-- ⚠️ APRE OU FIN LANSE L, gen YON SÈL lòt bagay pou fè:
--    Sou Render → sèvis backend la → Environment → ajoute:
--        DEMO_ACCOUNT_EMAILS = demo.review@fredapay.com
--    San varyab sa a, kont lan ap fè VRÈ tranzaksyon. Se li ki
--    aktive mòd similasyon an.
-- ============================================================


-- ── ETAP 1: pgcrypto (pou hash modpas la) ───────────────────
-- Supabase gen li deja — liy sa a jis asire w li aktive.
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ── ETAP 2: kolòn `is_demo` ─────────────────────────────────
-- Drapo ki make kont demo yo. Backend la li l epi li simile tout
-- apèl patnè (Maplerad, Pay'm, Didit) pou kont sa yo.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_users_is_demo
  ON users (is_demo) WHERE is_demo = TRUE;

COMMENT ON COLUMN users.is_demo IS
  'Kont demo pou revizè App Store/Play Store. Backend la simile tout apèl patnè — okenn vrè tranzaksyon.';


-- ── ETAP 3: kreye/mete-ajou kont demo a ─────────────────────
-- 🔑 Modpas la: FredaDemo2026!
--    Pou chanje l, ranplase l nan DE kote anba a (crypt(...)).
--    `gen_salt('bf', 10)` bay yon hash bcrypt egzakteman menm fòma
--    ak sa `bcryptjs` backend la ap tann.
INSERT INTO users (
  email, password_hash, firstname, lastname,
  phone, dial_code, country, city, date_of_birth, genre,
  freda_tag, role, status, kyc_status,
  email_verified, phone_verified, is_demo
)
VALUES (
  'demo.review@fredapay.com',
  crypt('FredaDemo2026!', gen_salt('bf', 10)),
  'Demo', 'Reviewer',
  '50900000000', '+509', 'HT', 'Port-au-Prince', '1995-01-01', 'Autre',
  'demoreview', 'user', 'active',
  -- KYC apwouve davans: revizè a pa gen dokiman nou yo, men li dwe
  -- ka teste kat vityèl yo (ki mande KYC).
  'approved',
  TRUE, TRUE, TRUE
)
ON CONFLICT (email) DO UPDATE SET
  password_hash  = crypt('FredaDemo2026!', gen_salt('bf', 10)),
  status         = 'active',
  kyc_status     = 'approved',
  email_verified = TRUE,
  phone_verified = TRUE,
  is_demo        = TRUE,
  updated_at     = NOW();


-- ── ETAP 4: ranpli wallet la ak lajan DEMO ──────────────────
-- 100000 santim = $1,000.00
INSERT INTO wallets (user_id, currency, balance, available_balance, pending_balance, is_active)
SELECT id, 'USD', 100000, 100000, 0, TRUE
  FROM users WHERE email = 'demo.review@fredapay.com'
ON CONFLICT (user_id, currency) DO UPDATE SET
  balance           = 100000,
  available_balance = 100000,
  pending_balance   = 0,
  is_active         = TRUE,
  updated_at        = NOW();


-- ── ETAP 5: verifikasyon ────────────────────────────────────
-- Rezilta a dwe montre 1 liy ak is_demo = true epi balans 100000.
SELECT
  u.email,
  u.freda_tag,
  u.status,
  u.kyc_status,
  u.is_demo,
  w.balance AS balans_santim,
  (w.balance / 100.0) AS balans_dola
FROM users u
LEFT JOIN wallets w ON w.user_id = u.id AND w.currency = 'USD'
WHERE u.email = 'demo.review@fredapay.com';


-- ============================================================
-- ⚠️ SI ETAP 3 BAY YON ERÈ tankou:
--    ERROR: function gen_salt(unknown, integer) does not exist
--
-- Sa vle di pgcrypto enstale nan yon lòt schema. Nan ka sa a,
-- ranplase `crypt(` pa `extensions.crypt(` epi `gen_salt(` pa
-- `extensions.gen_salt(` nan ETAP 3 la, epi relanse.
-- ============================================================
