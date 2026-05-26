-- Migration 030 — per-employee "attendance_required" flag.
--
-- Some employees (e.g. salaried staff paid a flat wage regardless of daily
-- presence) don't need to be marked every day. Those employees are still on
-- the payroll / wage register but should not clutter the supervisor's Mark
-- Attendance screen.
--
-- Default is TRUE so existing employees keep their current behaviour.

ALTER TABLE employee
  ADD COLUMN IF NOT EXISTS attendance_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN employee.attendance_required IS
  'When false, this employee is hidden from /attendance/mark but still appears on wages and reports.';
