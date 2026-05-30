-- 061_wage_entry_normalize_period_to_iso_week.sql
--
-- Backfill: every wage_entry row must have period_start = Monday of the
-- ISO week containing pay_date, period_end = Sunday of that week. This
-- mirrors the new Wage Entry form rule where the period pickers are
-- locked and always auto-derive from the pay date.
--
-- date_trunc('week', date) in Postgres returns the Monday (ISO week start)
-- at 00:00:00; casting back to date drops the time. Adding 6 days lands on
-- Sunday.

BEGIN;

UPDATE public.wage_entry
SET    period_start = date_trunc('week', pay_date)::date,
       period_end   = date_trunc('week', pay_date)::date + 6
WHERE  period_start <> date_trunc('week', pay_date)::date
   OR  period_end   <> date_trunc('week', pay_date)::date + 6;

COMMIT;
