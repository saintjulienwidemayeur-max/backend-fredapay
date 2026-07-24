-- ============================================================
-- Migration: Sipò estati 'deleted' pou kont itilizatè (efasman kont)
-- ============================================================
-- ✅ Apple ak Google TOU DE mande app finansye yo ofri efasman kont
-- ANNDAN app la. ✅ FIX: pa itilize yon non kontrent DIR ("users_status_
-- check") — Postgres ka jenere yon non OTOMATIK diferan (sa te lakòz yon
-- pwoblèm SIMILÈ ak `cards_status_check` pi bonè). Nou chèche VRÈ non an
-- nan `information_schema` anvan nou efase l, pou evite menm erè a.

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT con.conname INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'users' AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%status%pending%active%suspended%banned%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE users ADD CONSTRAINT users_status_check
    CHECK (status IN ('pending', 'active', 'suspended', 'banned', 'deleted'));
END $$;

-- ✅ Kolòn pou trase kilè yon kont te efase (itil pou dilijans/regilasyon)
ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
