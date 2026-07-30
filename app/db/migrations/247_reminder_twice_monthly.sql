-- 247_reminder_twice_monthly.sql
--
-- Adds a 'twice_monthly' repeat option to Reminders (migrations 245, 246),
-- for things like two bills due on fixed days every month (e.g. rent on
-- the 1st and the power bill on the 15th).
--
-- New repeat_monthdays smallint[] column holds the two day-of-month
-- numbers when repeat='twice_monthly'; NULL for every other repeat value.
-- Full custom selection: any 2 distinct days 1-31. App-layer nextDueDate
-- clamps a target day that doesn't exist in a given month (e.g. 31 in
-- April) down to that month's last day, so every month still matches.

BEGIN;

ALTER TABLE public.reminder DROP CONSTRAINT IF EXISTS reminder_repeat_check;
ALTER TABLE public.reminder
  ADD CONSTRAINT reminder_repeat_check
  CHECK (repeat IN ('none', 'daily', 'weekly', 'twice_weekly', 'monthly', 'twice_monthly'));

ALTER TABLE public.reminder ADD COLUMN IF NOT EXISTS repeat_monthdays smallint[];

ALTER TABLE public.reminder DROP CONSTRAINT IF EXISTS reminder_repeat_monthdays_check;
ALTER TABLE public.reminder
  ADD CONSTRAINT reminder_repeat_monthdays_check
  CHECK (
    (repeat = 'twice_monthly' AND array_length(repeat_monthdays, 1) = 2
       AND repeat_monthdays[1] BETWEEN 1 AND 31 AND repeat_monthdays[2] BETWEEN 1 AND 31
       AND repeat_monthdays[1] <> repeat_monthdays[2])
    OR (repeat <> 'twice_monthly' AND repeat_monthdays IS NULL)
  );

COMMIT;
