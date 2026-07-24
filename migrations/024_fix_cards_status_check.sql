-- ============================================================
-- Migration 024: URGENT — fix contrent 'cards_status_check'
-- ============================================================
-- ✅ FIX KRITIK: kontrent orijinal la (migration 001) te sèlman aksepte
-- ('active', 'blocked', 'pending') — men kòd la itilize 'terminated' (lè
-- yon kat siprime/tèmine pou tout tan) ak 'suspended' (Carte.tsx) tou.
-- Rezilta: CHAK tantativ siprime yon kat te echwe ak yon erè 500
-- ("violates check constraint cards_status_check") — kat la te TÈMINE
-- byen sou Maplerad, men DB lokal la te rejte mizajou a, kidonk kat la
-- te rete parèt kòm si l te toujou aktif nan app la.

ALTER TABLE cards DROP CONSTRAINT IF EXISTS cards_status_check;
ALTER TABLE cards ADD CONSTRAINT cards_status_check
  CHECK (status IN ('active', 'blocked', 'pending', 'suspended', 'terminated'));
