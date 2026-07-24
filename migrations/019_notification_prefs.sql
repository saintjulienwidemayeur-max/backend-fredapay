-- ============================================================
-- Migration 019: Preferans notifikasyon itilizatè (notif_prefs)
-- ============================================================
-- ✅ FIX: bouton "Notifications" nan Pwofil la te yon DEMO total. Frontend
-- (`NotifModal` nan Profile.tsx) te deja konplètman bati — 4 switch
-- (Transferts, Sécurité, Marketing, News), yon apèl PATCH /api/users/profile
-- pou sove yo, e menm yon "toast siksè". Men:
--   1. Kolòn sa a pa t janm egziste — okenn kote pou done a ale.
--   2. `notifPrefs` pa t nan lis chan "allowed" nan routes/users.ts, kidonk
--      backend te IYORE l an silans e reponn 200 OK kanmenm.
--   3. Menm si li te sove, `NotificationService.send()` pa t janm konsilte
--      l — okenn notifikasyon pa t janm respekte chwa itilizatè a.
-- Rezilta: itilizatè a te ka dezaktive "Marketing" oswa "Sécurité", wè yon
-- mesaj siksè, epi chak fwa li rekonekte swich yo te retounen nan defo yo
-- — paske anyen pa t janm sove pou vre.

ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_prefs JSONB;

COMMENT ON COLUMN users.notif_prefs IS 'Preferans notifikasyon itilizatè a: {transfers, security, marketing, news} (boolean chak). NULL = tout aktive pa defo.';
