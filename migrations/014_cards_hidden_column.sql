-- ============================================================
-- Migration 014: Kolòn "hidden" pou bouton "Supprimer ma carte"
-- ============================================================
-- Lè kliyan klike "Supprimer ma carte", nou PA efase ranje a nan DB (nou
-- bezwen kenbe istorik tranzaksyon ak referans pou konfòmite/odit). Olye de
-- sa, nou mete `hidden = true` epi GET /api/maplerad/cards filtre kat sa yo
-- deyò. Si kat la poko TERMINATED sou Maplerad, nou jele l (freeze) anvan
-- nou kache l, kòm mezi sekirite.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN cards.hidden IS 'true = kliyan "siprime" kat la nan app la (soft-delete). Kat la rete nan DB pou istorik/odit men pa parèt nan lis kliyan an.';

CREATE INDEX IF NOT EXISTS idx_cards_hidden ON cards(hidden) WHERE hidden = FALSE;
