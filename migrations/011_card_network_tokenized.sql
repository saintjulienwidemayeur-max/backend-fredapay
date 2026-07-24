-- ============================================================
-- Migration 011: Separe rezo kat (visa/mastercard) ak estati tokenized
-- ============================================================
-- Kolòn card_type gen yon CHECK CONSTRAINT ki sèlman aksepte
-- 'mastercard'/'visa' — men kòd la te voye 'tokenized'/'virtual_usd',
-- ki te VYOLE kontrent lan. Sa te fè upsert() echwe AN SILANS
-- (okenn erè pa t tcheke), kidonk kat yo te kreye sou Maplerad
-- men yo pa t janm anrejistre lokalman → yo pa t parèt nan lis la.
--
-- Solisyon: card_type ap kenbe rezo a (visa/mastercard), epi nou
-- ajoute yon kolòn separe pou tokenized (Apple/Google Pay).

ALTER TABLE cards ADD COLUMN IF NOT EXISTS is_tokenized BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN cards.is_tokenized IS 'true = kat tokenized (Apple/Google Pay, is_contactless), false = kat debit klasik';
