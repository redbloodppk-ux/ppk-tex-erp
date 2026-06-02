-- 077_employee_default_sheds.sql
--
-- Adds employee.default_sheds (text[]) so each employee can carry a
-- default set of sheds they cover. The Attendance Marking page reads
-- this when no attendance row exists yet for the (employee, day, shift)
-- so supervisors don't have to re-tick the same sheds every shift -
-- particularly useful for fitters and winders.

BEGIN;

ALTER TABLE public.employee
  ADD COLUMN IF NOT EXISTS default_sheds text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.employee.default_sheds IS
  'Default sheds the employee covers (e.g. {"1","3"}). Pre-fills attendance-marking shed picker.';

COMMIT;
