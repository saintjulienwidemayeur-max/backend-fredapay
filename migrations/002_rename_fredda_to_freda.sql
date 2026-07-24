-- ============================================================
-- FREDA PAY — Migration 002: Renome kolonn fredda_tag → freda_tag
-- Itilize si ou deja gen tablo yo kreye avèk "fredda_tag"
-- Kole nan: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── TABLE users: fredda_tag → freda_tag ──────────────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'fredda_tag'
  ) THEN
    ALTER TABLE users RENAME COLUMN fredda_tag TO freda_tag;
    RAISE NOTICE 'users.fredda_tag → freda_tag ✓';
  ELSE
    RAISE NOTICE 'users.freda_tag deja kòrèk ✓';
  END IF;
END $$;

-- ── TABLE transfers: from_fredda_tag → from_freda_tag ────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transfers' AND column_name = 'from_fredda_tag'
  ) THEN
    ALTER TABLE transfers RENAME COLUMN from_fredda_tag TO from_freda_tag;
    RAISE NOTICE 'transfers.from_fredda_tag → from_freda_tag ✓';
  ELSE
    RAISE NOTICE 'transfers.from_freda_tag deja kòrèk ✓';
  END IF;
END $$;

-- ── TABLE transfers: to_fredda_tag → to_freda_tag ────────────
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transfers' AND column_name = 'to_fredda_tag'
  ) THEN
    ALTER TABLE transfers RENAME COLUMN to_fredda_tag TO to_freda_tag;
    RAISE NOTICE 'transfers.to_fredda_tag → to_freda_tag ✓';
  ELSE
    RAISE NOTICE 'transfers.to_freda_tag deja kòrèk ✓';
  END IF;
END $$;

-- ── Rekree INDEX sou non kòrèk si necesè ────────────────────
DROP INDEX IF EXISTS idx_users_fredda_tag;
CREATE INDEX IF NOT EXISTS idx_users_freda_tag ON users(freda_tag);

-- ── Verifye rezilta final ────────────────────────────────────
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('users', 'transfers')
  AND column_name LIKE '%freda%'
ORDER BY table_name, column_name;
