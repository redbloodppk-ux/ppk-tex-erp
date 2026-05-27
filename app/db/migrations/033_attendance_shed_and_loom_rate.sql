-- Migration 033 — Per-entry shed on attendance + default ₹/m on looms
--
-- Two related additions that together make weaver wages auto-computable:
--
-- 1. attendance_entry.shed_no — the supervisor picks which shed an employee
--    actually worked in that shift. Same employee can move sheds day-to-day,
--    so this lives on the per-entry row (not employee, not attendance_day).
--    Nullable for backward-compatibility with pre-T4 history.
--
-- 2. loom.default_rate_per_m — owner-set ₹/m for that loom. When a
--    metre-basis weaver settles a week, the Wage form auto-suggests
--    Amount = SUM(produced_m on that loom in the period) × rate. The
--    operator can override before saving — the rate is just a default.
--
-- Both columns are nullable to keep the change non-breaking. Re-runnable.

BEGIN;

ALTER TABLE attendance_entry
  ADD COLUMN IF NOT EXISTS shed_no text;

COMMENT ON COLUMN attendance_entry.shed_no IS
  'Which shed (A/B/C/D) this employee worked in for this shift. Lets the '
  'wage allocator know where the labour landed without forcing a global '
  'employee-to-loom assignment. Nullable for legacy rows. CORR-T4 follow-up.';

ALTER TABLE loom
  ADD COLUMN IF NOT EXISTS default_rate_per_m numeric(8,2);

COMMENT ON COLUMN loom.default_rate_per_m IS
  'Default weaving rate (rupees per metre) for this loom. Used by the Wage '
  'entry form to suggest a metre-basis weaver''s settlement amount. The '
  'operator can override the suggestion before saving. CORR-T4 follow-up.';

COMMIT;
