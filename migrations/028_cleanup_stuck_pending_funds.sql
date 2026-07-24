-- ============================================================
-- Netwayaj YON SÈL FWA: antre "card_fund" ki rete kwense "pending"
-- ============================================================
-- ✅ KONTÈKS: yon bug (kounye a korije) te fè `/fund` sove referans LOKAL
-- kat la nan ledger a olye VRÈ ID Maplerad la — webhook konfimasyon an pa
-- t janm jwenn match, kidonk antre sa yo rete "pending" pou tout tan menm
-- lè lajan an te vrèman ateri sou kat la (balans kat la te DEJA mete ajou
-- pa menm webhook la, endepandaman de match ledger la).
--
-- SQL sa a make TOUT antre "card_fund" ki "pending" kòm "completed" —
-- san danje, paske balans kat yo DEJA kòrèk; se sèlman AFICHAJ istorik la
-- ki te rete kwense.

UPDATE transactions_ledger
SET status = 'completed', completed_at = COALESCE(completed_at, now())
WHERE type = 'card_fund' AND status = 'pending';
