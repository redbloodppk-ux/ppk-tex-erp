-- 027_today_attendance_widget_view.sql — CORR-A6
--
-- One-row-per (role × shift) snapshot for *today* used by the dashboard
-- "Today's Attendance" widget. `headcount` is the count of active
-- employees in that role (so the supervisor can see "8 / 12 present").
-- `present_count` is the number of attendance entries that count as a
-- working day (present / late / early_leave) for today's shift.
--
-- `is_working` reflects the holiday flag on the matching attendance_day
-- (true by default — only false when the supervisor has marked the shift
-- non-working in CORR-A3). `reason` and `remark` carry the holiday
-- detail so the dashboard can show the red banner.
--
-- security_invoker = on so row-level security on the base tables still
-- applies to the person opening the dashboard.

DROP VIEW IF EXISTS v_today_attendance_widget;
CREATE VIEW v_today_attendance_widget
  WITH (security_invoker = on) AS
WITH today AS (
  SELECT CURRENT_DATE AS d
),
roles AS (
  SELECT e.role AS employee_role,
         count(*) FILTER (WHERE e.status = 'active') AS headcount
  FROM employee e
  GROUP BY e.role
),
shifts AS (
  SELECT unnest(ARRAY['morning', 'night']::shift_code[]) AS shift
),
day_flag AS (
  SELECT s.shift,
         COALESCE(ad.is_working, true)         AS is_working,
         ad.reason::text                       AS reason,
         ad.remark                             AS remark,
         ad.id                                 AS attendance_day_id
  FROM shifts s
  LEFT JOIN attendance_day ad
    ON ad.shift = s.shift
   AND ad.attendance_date = (SELECT d FROM today)
),
present AS (
  SELECT df.shift,
         e.role AS employee_role,
         count(*) FILTER (
           WHERE ae.status IN ('present', 'late', 'early_leave')
         ) AS present_count
  FROM day_flag df
  LEFT JOIN attendance_entry ae ON ae.attendance_day_id = df.attendance_day_id
  LEFT JOIN employee e          ON e.id = ae.employee_id
  GROUP BY df.shift, e.role
)
SELECT
  df.shift,
  r.employee_role,
  r.headcount,
  COALESCE(p.present_count, 0) AS present_count,
  df.is_working,
  df.reason,
  df.remark,
  (SELECT d FROM today)        AS attendance_date
FROM day_flag df
CROSS JOIN roles r
LEFT JOIN present p
  ON p.shift = df.shift
 AND p.employee_role = r.employee_role
WHERE r.headcount > 0
ORDER BY df.shift, r.employee_role;
