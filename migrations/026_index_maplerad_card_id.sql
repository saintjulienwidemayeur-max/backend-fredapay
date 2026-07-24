-- ============================================================
-- Migration 026: Endèks ki manke sou cards.maplerad_card_id
-- ============================================================
-- ✅ FIX PÈFÒMANS: migration 012 ajoute `maplerad_card_id` san okenn
-- endèks. Men `db.cards.findByCardId()` — rele nan PRESKE CHAK webhook
-- (`issuing.transaction`, `issuing.terminated`, `issuing.activation`) ak
-- nan boukle senkwonizasyon balans yo (kliyan AK admin) — fè yon rechèch
-- `.or("cardid.eq.X,id.eq.X,maplerad_card_id.eq.X")`. San endèks sou
-- `maplerad_card_id`, branch sa a nan rechèch "OR" a fòse yon SCAN KONPLÈ
-- tab `cards` la CHAK FWA. Sa vin pi lan pandan tab la grandi ak plis
-- itilizatè/kat. `WHERE ... IS NOT NULL` fè endèks la pi piti/pi rapid,
-- paske kat "pending" san `maplerad_card_id` ankò pa janm rechèche pa
-- valè sa a.

CREATE INDEX IF NOT EXISTS idx_cards_maplerad_card_id
  ON cards(maplerad_card_id) WHERE maplerad_card_id IS NOT NULL;
