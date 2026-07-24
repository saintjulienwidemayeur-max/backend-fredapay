-- ============================================================
-- Migration 018 : aliyen kyc_sessions.status ak vrè estati Didit yo
-- ============================================================
-- ✅ FIX: CHECK constraint orijinal la (001_initial_schema.sql) te
-- otorize ('Pending', 'In Progress', 'Approved', 'Declined',
-- 'In Review', 'Expired') — men API Didit la voye 'Not Started'
-- (PA 'Pending'), e li manke 'Abandoned', 'Resubmitted',
-- 'Kyc Expired', 'Awaiting User' nèt. Chak fwa kòd la eseye kreye
-- yon sesyon KYC, insert la echwe ak:
--   "new row for relation kyc_sessions violates check constraint
--    kyc_sessions_status_check"
-- ki fè sesyon Didit la kreye REYÈLMAN (l egziste sou Didit, e
-- webhook li rive) men li pa janm sove lokalman → webhook ki swiv
-- yo bay "Session KYC inconnue" paske `session_id` a pa jwenn nan DB.

-- Si gen ansyen ranje ak 'Pending' (valè ki pa t janm ekri pa API
-- Didit la — pwobableman done tès), mete yo ajou anvan nou aplike
-- nouvo konstrent lan.
UPDATE kyc_sessions SET status = 'Not Started' WHERE status = 'Pending';

ALTER TABLE kyc_sessions
  DROP CONSTRAINT IF EXISTS kyc_sessions_status_check;

ALTER TABLE kyc_sessions
  ALTER COLUMN status SET DEFAULT 'Not Started';

ALTER TABLE kyc_sessions
  ADD CONSTRAINT kyc_sessions_status_check
  CHECK (status IN (
    'Not Started', 'In Progress', 'Approved', 'Declined',
    'In Review', 'Abandoned', 'Resubmitted', 'Expired',
    'Kyc Expired', 'Awaiting User'
  ));
