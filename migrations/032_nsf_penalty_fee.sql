-- ============================================================
-- 032 — Frè penalite NSF (Non-Sufficient Funds) — $0.50
-- ============================================================
-- Lè yon moun eseye yon tranzaksyon kat men wallet li PA GEN ase lajan,
-- nou aplike yon penalite $0.50 SAN nou pa janm rele Maplerad.
--
-- ⚠️ ATANSYON — SA A PA MENM BAGAY AK `card_txn_declined` ($0.40):
--   • card_txn_declined ($0.40) = MAPLERAD refize tranzaksyon an (moun nan
--     TE GEN lajan, nou te rele API a, li refize).
--   • card_txn_nsf ($0.50)      = NOU refize AVAN nou rele Maplerad, paske
--     moun nan PA T GEN lajan an ditou.
-- De frè diferan pou de sitiyasyon diferan — yo pa dwe janm tou de aplike
-- sou menm tantativ la.
--
-- Frè a modifyab pa admin/comptable atravè menm tab `card_fees` la (menm
-- mekanis ak tout lòt frè kat yo — wè CardFeesService).

INSERT INTO card_fees (key, label, amount_cents) VALUES
  ('card_txn_nsf', 'Pénalité fonds insuffisants (NSF)', 50)
ON CONFLICT (key) DO NOTHING;

-- Frè Freda Pay pwòp nou an sou yon tranzaksyon kat.
-- NÒT ENPÒTAN: Maplerad DEDWI PWÒP frè pa li DIRÈKTEMAN pandan tranzaksyon
-- kat la. Backend nou an PA dwe kalkile ni ajoute frè Maplerad — SÈLMAN
-- frè Freda Pay pa nou an.
INSERT INTO card_fees (key, label, amount_cents) VALUES
  ('card_txn_freda_fee', 'Frais Freda Pay sur transaction carte', 50)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE card_fees IS 'Frè kat/wallet modifyab pa admin/comptable — remplace valè ki te hardcode nan fees.config.ts. Gen ladan card_txn_nsf (penalite fon ensifizan) ak card_txn_freda_fee (frè pwòp Freda Pay, PA frè Maplerad).';
