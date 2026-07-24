-- ============================================================
-- 033 — Bonjou chak maten + rapèl biometrik
-- ============================================================
-- `last_greeted_on`        : DATE (pa timestamp) — konsa yon moun jwenn yon
--                            SÈL bonjou pa jou menm si cron an kouri 2 fwa.
-- `biometric_enabled`      : app la mete l TRUE lè moun nan aktive Face ID/
--                            anprent. Nou sispann rapèl la lè sa a.
-- `biometric_prompted_at`  : dènye fwa nou te voye rapèl la (max 1 chak 7 jou).

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_greeted_on       DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_enabled     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS biometric_prompted_at TIMESTAMPTZ;

-- Cron an chèche moun ki poko gen bonjou jodi a — endèks la kenbe l rapid.
CREATE INDEX IF NOT EXISTS idx_users_last_greeted_on ON users(last_greeted_on);

COMMENT ON COLUMN users.last_greeted_on       IS 'Dènye jou nou voye push bonjou a (DATE — youn pa jou max)';
COMMENT ON COLUMN users.biometric_enabled     IS 'Moun nan aktive Face ID/anprent — sispann rapèl yo';
COMMENT ON COLUMN users.biometric_prompted_at IS 'Dènye rapèl biometrik voye (max 1 chak 7 jou)';
