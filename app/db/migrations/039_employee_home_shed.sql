-- Migration 039: Add employee.home_shed_no
--
-- Weavers normally belong to one shed. When marked absent without picking a
-- shed, the weekly-summary winder-deduction logic has no way to attribute the
-- absence. home_shed_no is the stable per-weaver assignment used as a
-- fallback for absent rows whose shed_no is NULL.

ALTER TABLE employee ADD COLUMN IF NOT EXISTS home_shed_no text;

-- Backfill: set every employee's home_shed_no to the most recent non-null
-- shed_no across their attendance rows.
WITH latest AS (
  SELECT DISTINCT ON (ae.employee_id)
    ae.employee_id,
    ae.shed_no
  FROM attendance_entry ae
  JOIN attendance_day ad ON ad.id = ae.attendance_day_id
  WHERE ae.shed_no IS NOT NULL
  ORDER BY ae.employee_id, ad.attendance_date DESC, ae.id DESC
)
UPDATE employee e
SET home_shed_no = l.shed_no
FROM latest l
WHERE e.id = l.employee_id
  AND e.home_shed_no IS NULL;
