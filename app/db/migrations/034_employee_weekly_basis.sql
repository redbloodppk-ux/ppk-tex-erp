-- 034_employee_weekly_basis.sql
-- Add 'weekly' as a valid wage_alloc_basis option and make it the default.

ALTER TABLE employee DROP CONSTRAINT IF EXISTS employee_wage_alloc_basis_check;

ALTER TABLE employee
  ADD CONSTRAINT employee_wage_alloc_basis_check
  CHECK (wage_alloc_basis IN ('metres','loom_shifts','weekly'));

ALTER TABLE employee ALTER COLUMN wage_alloc_basis SET DEFAULT 'weekly';
