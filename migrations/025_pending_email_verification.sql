-- ============================================================
-- Migration 025: Verifikasyon imèl AVAN kreyasyon kont
-- ============================================================
-- ✅ NOUVO: ansyen sistèm nan (`users.email_verification_code`) mande yon
-- kont DEJA egziste — kidonk verifikasyon te sèlman posib APRE tout enskri-
-- psyon fini (ak modpas la deja chwazi). Kliyan mande verifikasyon fèt AVAN
-- moun nan menm rive nan etap modpas la. Tab sa a estoke yon kòd tanporè
-- ki lye a yon ADRÈS IMÈL sèlman (pa gen kont ankò).

CREATE TABLE IF NOT EXISTS pending_email_verifications (
  email        TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  verified     BOOLEAN NOT NULL DEFAULT false,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE pending_email_verifications IS 'Kòd verifikasyon imèl AVAN kont kreye — itilize pandan enskripsyon, anvan etap modpas la.';
