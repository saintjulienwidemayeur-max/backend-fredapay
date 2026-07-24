-- ============================================================
-- Migration 023: Retire metòd siplemantè migration 022 te ajoute yo
-- ============================================================
-- ✅ FIX: 022 te ajoute 5 metòd "retrè sèlman" (Ghana, bank_usd, eft_za,
-- elt) baze sou yon move sipozisyon. Kliyan konfime: se SÈLMAN 20 mwayen
-- depo ki egziste nan app la — pa gen metòd siplemantè pou jere apa.
-- Si w pa t janm kouri 022, migration sa a senpleman pa fè anyen (san danje).

DELETE FROM payment_fees WHERE method_id IN (
  'mtn_gh', 'airtel_gh', 'vodafone_gh',
  'mtn_xaf', 'orange_xaf', 'mtn_xof', 'orange_xof',
  'safaricom_ke', 'eft_za', 'bank_usd'
);
