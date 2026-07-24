-- ============================================================
-- Migration 020: Anons app la, mòd mentnans, ak Inbox imèl
-- ============================================================

-- ── Anons/bannyè admin ka montre sou app kliyan an ─────────────
CREATE TABLE IF NOT EXISTS announcements (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message             TEXT NOT NULL,
  is_active           BOOLEAN NOT NULL DEFAULT false,
  is_scrolling        BOOLEAN NOT NULL DEFAULT false,
  tone                TEXT NOT NULL DEFAULT 'info' CHECK (tone IN ('info','warning','danger','success')),
  created_by_admin_id UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE announcements IS 'Anons/bannyè admin ka pibliye sou app kliyan an. Backend garanti yon sèl aktif alafwa.';

-- ── Paramèt jeneral app la (kle→valè JSON) ─────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  key                 TEXT PRIMARY KEY,
  value               JSONB NOT NULL,
  updated_by_admin_id UUID REFERENCES users(id),
  updated_at          TIMESTAMPTZ DEFAULT now()
);
COMMENT ON TABLE app_settings IS 'Paramèt jeneral app la (kle-valè) — egzanp: maintenance_mode {enabled, message}.';

INSERT INTO app_settings (key, value) VALUES
  ('maintenance_mode', '{"enabled": false, "message": ""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ── Inbox imèl — contact@fredapay.com / support@fredapay.com ──
CREATE TABLE IF NOT EXISTS inbox_emails (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction           TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  mailbox             TEXT NOT NULL,   -- 'contact@fredapay.com' oswa 'support@fredapay.com'
  from_email          TEXT NOT NULL,
  from_name           TEXT,
  to_email            TEXT NOT NULL,
  subject             TEXT,
  body_text           TEXT,
  body_html           TEXT,
  thread_id           UUID,            -- gwoupe mesaj ansanm nan menm konvèsasyon an
  is_read             BOOLEAN NOT NULL DEFAULT false,
  replied_by_admin_id UUID REFERENCES users(id),
  raw_payload         JSONB,           -- peyòd brit webhook la — itil pou dyagnostik
  created_at          TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inbox_emails_thread   ON inbox_emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_inbox_emails_mailbox  ON inbox_emails(mailbox, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_emails_unread   ON inbox_emails(is_read) WHERE is_read = false;
COMMENT ON TABLE inbox_emails IS 'Imèl resevwa (webhook Brevo Inbound Parsing) ak repons admin voye pou contact@/support@fredapay.com.';
