-- ============================================================
-- Migration 008: Retire dènye tras Korapay nan baz done a
-- ============================================================
-- Kolòn sa a te kreye pa migration 005 pou Korapay card holder.
-- Depi kòd la migre nèt sou Maplerad, li pa itilize ankò okenn kote.

ALTER TABLE users DROP COLUMN IF EXISTS korapay_cardholder_ref;
