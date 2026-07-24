-- ============================================================
-- Migration 012: Kenbe vrè ID kat Maplerad la separeman
-- ============================================================
-- `cardid` nan tab cards la se REFERANS PA NOU (ex: "CARD-xxxx"),
-- jenere lè kreyasyon an. Men Maplerad bay yon ID PA LI a
-- (`card.id`) SÈLMAN nan webhook "issuing.created.successful" la,
-- e se ID sa a li egzije pou GET detay, freeze/unfreeze, fund,
-- withdraw, ak transactions — pa referans nou an. Depi nou pa t
-- janm sove `card.id`, tout wout sa yo te rele Maplerad ak yon ID
-- li pa rekonèt → "detay kat pa moute", 405/404 sou freeze, elt.

ALTER TABLE cards ADD COLUMN IF NOT EXISTS maplerad_card_id TEXT;
COMMENT ON COLUMN cards.maplerad_card_id IS 'Vrè ID kat la sou Maplerad (card.id nan webhook) — sèvi pou tout apèl API Maplerad sou kat sa a';
