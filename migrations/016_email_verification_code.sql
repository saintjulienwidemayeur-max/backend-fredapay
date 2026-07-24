-- ============================================================
-- Migration 016: Kòd verifikasyon imèl (OTP kreyasyon kont)
-- ============================================================
-- ✅ FIX: kòd OTP la te JENERE e VOYE pa imèl lè kreyasyon kont, men li
-- pa t janm SOVE okenn kote — kidonk backend pa t janm ka verifye l.
-- Frontend (`VerifyEmail.tsx`) te deja konplètman bati e li t ap rele
-- `/api/auth/verify-email/send` ak `/confirm` — de wout ki pa t egziste
-- ditou nan backend la. Migrasyon sa a ajoute estokaj kòd la.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code       TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN users.email_verification_code IS 'Kòd 6-chif aktyèl la — null si pa gen youn an atant oswa deja verifye';
COMMENT ON COLUMN users.email_verification_expires_at IS 'Lè kòd la ekspire (15 min apre voye)';
