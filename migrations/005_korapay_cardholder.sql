-- Ajoute kolòn pou estoke referans cardholder Korapay
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS korapay_cardholder_ref TEXT;

COMMENT ON COLUMN users.korapay_cardholder_ref IS 'Référence du card holder Korapay (requis avant créer carte virtuelle)';
