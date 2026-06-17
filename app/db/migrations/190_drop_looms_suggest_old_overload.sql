-- 190_drop_looms_suggest_old_overload.sql
--
-- Migration 133 created fn_looms_calibration_suggest(p_days_back).
-- Migration 136 added a SECOND overload with a wage-role filter:
--   fn_looms_calibration_suggest(p_days_back, p_wage_roles text[]).
-- Both have `p_days_back integer DEFAULT 30`, so when the UI calls
-- with just one int arg, Postgres throws:
--   "Could not choose the best candidate function between [...]"
--
-- The newer overload's p_wage_roles also has a DEFAULT, so it can be
-- called with only p_days_back. Drop the older single-arg version —
-- the new one fully supersedes it.

BEGIN;
DROP FUNCTION IF EXISTS public.fn_looms_calibration_suggest(integer);
COMMIT;
