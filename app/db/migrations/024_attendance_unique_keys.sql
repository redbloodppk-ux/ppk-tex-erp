-- ─────────────────────────────────────────────────────────────────────────
-- 024_attendance_unique_keys.sql
--
-- The Attendance feature (Daily Marking screen) needs to upsert rows so that
-- re-saving a date/shift overwrites the earlier entry instead of duplicating
-- it. The existing attendance tables only had a primary key on `id`, so this
-- migration adds the natural unique keys the screen relies on:
--
--   attendance_day   UNIQUE (attendance_date, shift)
--   attendance_entry UNIQUE (attendance_day_id, employee_id)
--
-- Idempotent: each constraint is added only when it does not already exist,
-- so the migration is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_attendance_day_date_shift'
  ) THEN
    ALTER TABLE attendance_day
      ADD CONSTRAINT uq_attendance_day_date_shift
      UNIQUE (attendance_date, shift);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_attendance_entry_day_employee'
  ) THEN
    ALTER TABLE attendance_entry
      ADD CONSTRAINT uq_attendance_entry_day_employee
      UNIQUE (attendance_day_id, employee_id);
  END IF;
END $$;

COMMIT;
