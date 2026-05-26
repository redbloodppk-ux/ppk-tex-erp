-- 026_attendance_report_views.sql — CORR-A5
--
-- Four read-only views that power the attendance reports. All use
-- security_invoker so row-level security on the base tables still
-- applies to the person reading the report.
--
-- A "day weight" is how much of a working day a status counts as:
--   present / late      = 1.0   (full day; late still worked the day)
--   half_day / early_leave = 0.5
--   absent              = 0.0
-- If attendance_entry.day_weight is filled in, that value wins.

-- 1. Per-employee detail — one row per marked employee/shift/day.
DROP VIEW IF EXISTS v_attendance_detail;
CREATE VIEW v_attendance_detail
  WITH (security_invoker = on) AS
SELECT
  d.attendance_date,
  d.shift,
  e.id          AS employee_id,
  e.code        AS employee_code,
  e.full_name   AS employee_name,
  e.role        AS employee_role,
  ae.status,
  COALESCE(
    ae.day_weight,
    CASE ae.status
      WHEN 'present'     THEN 1.0
      WHEN 'late'        THEN 1.0
      WHEN 'half_day'    THEN 0.5
      WHEN 'early_leave' THEN 0.5
      ELSE 0.0
    END
  )             AS day_weight,
  ae.remark     AS entry_remark
FROM attendance_day d
JOIN attendance_entry ae ON ae.attendance_day_id = d.id
JOIN employee e          ON e.id = ae.employee_id
WHERE d.is_working = true;

-- 2. Per-employee per-month summary.
DROP VIEW IF EXISTS v_attendance_monthly;
CREATE VIEW v_attendance_monthly
  WITH (security_invoker = on) AS
SELECT
  to_char(date_trunc('month', d.attendance_date), 'YYYY-MM') AS month,
  e.id        AS employee_id,
  e.code      AS employee_code,
  e.full_name AS employee_name,
  e.role      AS employee_role,
  count(*) FILTER (WHERE ae.status = 'present')     AS present_count,
  count(*) FILTER (WHERE ae.status = 'absent')      AS absent_count,
  count(*) FILTER (WHERE ae.status = 'half_day')    AS half_day_count,
  count(*) FILTER (WHERE ae.status = 'late')        AS late_count,
  count(*) FILTER (WHERE ae.status = 'early_leave') AS early_leave_count,
  count(*)                                          AS shifts_marked,
  round(sum(
    COALESCE(
      ae.day_weight,
      CASE ae.status
        WHEN 'present'     THEN 1.0
        WHEN 'late'        THEN 1.0
        WHEN 'half_day'    THEN 0.5
        WHEN 'early_leave' THEN 0.5
        ELSE 0.0
      END
    )
  ), 2)                                             AS attendance_days
FROM attendance_day d
JOIN attendance_entry ae ON ae.attendance_day_id = d.id
JOIN employee e          ON e.id = ae.employee_id
WHERE d.is_working = true
GROUP BY 1, 2, 3, 4, 5;

-- 3. Per-role per-month roll-up.
DROP VIEW IF EXISTS v_attendance_by_role;
CREATE VIEW v_attendance_by_role
  WITH (security_invoker = on) AS
SELECT
  to_char(date_trunc('month', d.attendance_date), 'YYYY-MM') AS month,
  e.role AS employee_role,
  count(DISTINCT e.id)                              AS employee_count,
  count(*) FILTER (WHERE ae.status = 'present')     AS present_count,
  count(*) FILTER (WHERE ae.status = 'absent')      AS absent_count,
  count(*) FILTER (WHERE ae.status = 'half_day')    AS half_day_count,
  count(*) FILTER (WHERE ae.status = 'late')        AS late_count,
  count(*) FILTER (WHERE ae.status = 'early_leave') AS early_leave_count,
  count(*)                                          AS shifts_marked,
  round(
    100.0 * count(*) FILTER (WHERE ae.status = 'present')
    / NULLIF(count(*), 0), 1
  )                                                 AS present_pct
FROM attendance_day d
JOIN attendance_entry ae ON ae.attendance_day_id = d.id
JOIN employee e          ON e.id = ae.employee_id
WHERE d.is_working = true
GROUP BY 1, 2;

-- 4. Non-working (holiday) days.
DROP VIEW IF EXISTS v_non_working_days;
CREATE VIEW v_non_working_days
  WITH (security_invoker = on) AS
SELECT
  d.attendance_date,
  d.shift,
  d.reason,
  d.remark,
  d.marked_at,
  au.full_name AS marked_by_name
FROM attendance_day d
LEFT JOIN app_user au ON au.id = d.marked_by
WHERE d.is_working = false;
