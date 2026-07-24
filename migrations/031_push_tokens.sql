-- ============================================================
-- Migration: Token push notifikasyon (Expo Push API)
-- ============================================================
-- ✅ NOUVO: `notification.service.ts` te deja gen yon kòmantè "TODO
-- production: if (priority === critical) this.sendPush(...)" — enfrastrikti
-- sa a te antisipe men pa t janm konplete. Yon itilizatè ka gen PLIZYÈ
-- aparèy (telefòn + tablèt), kidonk nou estoke plizyè token pa itilizatè.

CREATE TABLE IF NOT EXISTS push_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
