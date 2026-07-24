-- ============================================================
-- Migration 017 : retire 'pagocards' nan webhook_events.source
-- ============================================================
-- ✅ FIX: CHECK constraint orijinal la (001_initial_schema.sql) te
-- otorize sèlman ('pagocards', 'didit') pou `source`. Men webhook
-- Maplerad la (src/routes/webhooks.ts) toujou ensere avèk
-- source='maplerad' — yon valè ki PA nan lis la. Chak insert echwe
-- an silans (anba yon `.catch(() => null)`), sa vle di okenn evènman
-- Maplerad pa t janm anrejistre nan tab la, e dedup sou event_id pa
-- t janm fonksyone pou Maplerad. Pagocards se yon founisè kat ki pa
-- itilize ankò (ranplase pa Maplerad) — retire l nèt.

ALTER TABLE webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_source_check;

ALTER TABLE webhook_events
  ALTER COLUMN source SET DEFAULT 'maplerad';

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_source_check
  CHECK (source IN ('maplerad', 'didit'));

-- Aucune ligne 'pagocards' pa dwe egziste deja (founisè a pa t janm
-- fonksyone), men si gen kèk done tès ki tenyen, mete yo ajou pou yo
-- pa kraze constraint nouvo a.
UPDATE webhook_events SET source = 'maplerad' WHERE source = 'pagocards';
