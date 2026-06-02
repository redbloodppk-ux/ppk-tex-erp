-- 079_loom_idle_since.sql
--
-- Adds loom.idle_since (date). When a loom is marked non-running on the
-- Looms settings page (idle / maintenance / breakdown), the operator
-- supplies the date it became non-running. The Shift Production Log
-- then locks that loom for any log_date >= idle_since, but still allows
-- editing for historical dates BEFORE idle_since (when the loom was
-- running). NULL when the loom is currently running.

BEGIN;

ALTER TABLE public.loom
  ADD COLUMN IF NOT EXISTS idle_since date;

COMMENT ON COLUMN public.loom.idle_since IS
  'When the loom was marked non-running. Shift log entries on or after this date are locked.';

COMMIT;
