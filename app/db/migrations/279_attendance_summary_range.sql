-- ============================================================================
-- 279: Attendance summary for any date range, not just a whole month.
--
-- PPK, 2026-09-04, on the Monthly Attendance report: "we need date range
-- selection also for this report."
--
-- v_attendance_monthly is grouped by calendar month, so a range like
-- 24 Aug - 6 Sep cannot be asked of it at all. The obvious move is to write
-- a second query on the page for range mode. That would be two
-- implementations of "how many days did this person work", free to drift —
-- which this codebase has paid for repeatedly: the fitter wage reading
-- Rs 2,400 on screen and Rs 4,000 in the export, and withheld TDS reading
-- three ways across four screens.
--
-- So the counting rule moves into ONE function, and the month view is
-- rebuilt on top of it. The month report and the range report now ask the
-- same code the same question with different dates.
--
-- The rule itself is carried over EXACTLY as the view had it, including
-- half_day and early_leave counting 0.5 of a day and day_weight overriding
-- the status when set. This migration is about where the rule lives, not
-- what it says; changing both at once would make any difference in the
-- numbers impossible to attribute.
--
-- Verified after applying:
--   * all 75 existing view rows identical to the old inline rule, 0 diffs
--   * September as a month vs as a range: 11 rows each, 0 diffs
--   * 24 Aug - 6 Sep (a pay week across month end, impossible before):
--     13 employees, 92 presents, 14 absents
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_attendance_summary(p_from date, p_to date)
RETURNS TABLE (
  employee_id       bigint,
  employee_code     text,
  employee_name     text,
  employee_role     public.employee_role,
  present_count     bigint,
  absent_count      bigint,
  half_day_count    bigint,
  late_count        bigint,
  early_leave_count bigint,
  shifts_marked     bigint,
  attendance_days   numeric
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.id, e.code, e.full_name, e.role,
    count(*) FILTER (WHERE ae.status = 'present'::attendance_status),
    count(*) FILTER (WHERE ae.status = 'absent'::attendance_status),
    count(*) FILTER (WHERE ae.status = 'half_day'::attendance_status),
    count(*) FILTER (WHERE ae.status = 'late'::attendance_status),
    count(*) FILTER (WHERE ae.status = 'early_leave'::attendance_status),
    count(*),
    round(sum(COALESCE(ae.day_weight,
      CASE ae.status
        WHEN 'present'::attendance_status     THEN 1.0
        WHEN 'late'::attendance_status        THEN 1.0
        WHEN 'half_day'::attendance_status    THEN 0.5
        WHEN 'early_leave'::attendance_status THEN 0.5
        ELSE 0.0
      END)), 2)
  FROM attendance_day d
  JOIN attendance_entry ae ON ae.attendance_day_id = d.id
  JOIN employee e          ON e.id = ae.employee_id
  WHERE d.is_working = true
    AND d.attendance_date >= p_from
    AND d.attendance_date <= p_to
  GROUP BY e.id, e.code, e.full_name, e.role;
$$;

COMMENT ON FUNCTION public.fn_attendance_summary(date, date) IS
  'Per-employee attendance counts between two dates, working days only. The single source of the counting rule: v_attendance_monthly is built on it. See migration 279.';

-- Rebuild the month view on the function so the rule exists once.
-- Same columns, same order, same types as before.
DROP VIEW IF EXISTS public.v_attendance_monthly;
CREATE VIEW public.v_attendance_monthly AS
SELECT to_char(m.month_start, 'YYYY-MM') AS month, f.*
FROM (
  SELECT DISTINCT date_trunc('month', d.attendance_date)::date AS month_start
  FROM attendance_day d
  WHERE d.is_working = true
) m
CROSS JOIN LATERAL public.fn_attendance_summary(
  m.month_start,
  (m.month_start + interval '1 month' - interval '1 day')::date
) f;

COMMENT ON VIEW public.v_attendance_monthly IS
  'Month-by-month attendance summary. A thin wrapper over fn_attendance_summary so the month report and the date-range report cannot disagree. See migration 279.';

-- Verify:
--   select count(*) from v_attendance_monthly;                       -- 75
--   select * from fn_attendance_summary('2026-08-24','2026-09-06');  -- 13 rows
