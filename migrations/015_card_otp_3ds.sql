-- ============================================================
-- Migration 015: Kòd 3DS/OTP pou tranzaksyon kat (issuing.activation)
-- ============================================================
-- Maplerad voye yon "kòd aktivasyon" 6-chif via webhook `issuing.activation`
-- lè yon machann mande verifikasyon 3D Secure sou yon tranzaksyon kat.
-- Kontrèman ak bank tradisyonèl (ki voye SMS dirèkteman bay kliyan an),
-- Maplerad voye kòd la BA NOU — se NOU ki responsab montre l bay kliyan an
-- vit ase pou li antre l sou sit machann nan anvan delè a ekspire.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS otp_code       TEXT;
ALTER TABLE cards ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN cards.otp_code       IS 'Kòd 3DS aktyèl la (6 chif) resevwa via webhook issuing.activation — null si pa gen tranzaksyon an atant';
COMMENT ON COLUMN cards.otp_expires_at IS 'Lè kòd la ekspire (5 min apre resepsyon) — apre sa frontend pa dwe montre l ankò';

CREATE INDEX IF NOT EXISTS idx_cards_otp_pending ON cards(user_id, otp_expires_at) WHERE otp_code IS NOT NULL;
