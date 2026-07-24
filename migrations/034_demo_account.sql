-- ============================================================
-- 034 — Kont demo pou revizyon App Store / Play Store
-- ============================================================
-- Apple (App Review Guideline 2.1) ak Google mande yon kont demo
-- konplètman fonksyonèl. Kolòn `is_demo` a make kont sa yo: backend la
-- entèsepte tout apèl patnè (Maplerad, Pay'm, Didit) pou yo epi li
-- retounen repons simile — ZEWO vrè lajan, ZEWO vrè kat.
--
-- ⚠️ Kolòn sa a se yon drapo SANSIB. Okenn wout API pa dwe ka mete l.
-- Se sèlman via SQL (oswa script seed la) yon kont demo kreye.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Endèks pasyèl: gen sèlman 1-2 kont demo, donk yon endèks pasyèl se sa
-- ki pi lejè pou jwenn yo vit nan panèl admin lan.
CREATE INDEX IF NOT EXISTS idx_users_is_demo
  ON users (is_demo) WHERE is_demo = TRUE;

COMMENT ON COLUMN users.is_demo IS
  'Kont demo pou revizè App Store/Play Store. Backend la simile tout apèl patnè yo — okenn vrè tranzaksyon.';
