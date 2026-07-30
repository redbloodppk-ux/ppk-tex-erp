-- 248_reminder_biweekly.sql
--
-- Adds a 'biweekly' repeat option to Reminders (migrations 245-247) — for
-- things that recur once every 2 weeks (distinct from 'twice_weekly',
-- which fires twice within the same week on 2 chosen weekdays). No new
-- columns: biweekly just advances due_date by 14 days each cycle, so it
-- reuses the existing repeat_weekdays/repeat_monthdays = NULL shape.

BEGIN;

ALTER TABLE public.reminder DROP CONSTRAINT IF EXISTS reminder_repeat_check;
ALTER TABLE public.reminder
  ADD CONSTRAINT reminder_repeat_check
  CHECK (repeat IN ('none', 'daily', 'weekly', 'twice_weekly', 'biweekly', 'monthly', 'twice_monthly'));

COMMIT;
