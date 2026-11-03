-- 330: Employee Weekly Wages report (reports/employee-weekly-wages).
--
-- One row per employee per wage week (Monday-start, the wage period):
--   earned        = shift-log real metres x the rate frozen on each shift
--                   (weavers only; NULL for salaried staff)
--   metres        = metres as counted (society saree: folding metres)
--   same_day / advance / settlement / adjustment / extra_work
--                 = wage_entry amounts (GROSS) by kind
--   loan_deducted = part of those payments withheld for loan repayment
--                   (cash handed over = gross - loan_deducted)
-- The page computes: wage paid = same_day + advance + settlement + adjustment;
-- extra work is shown separately; balance = earned - wage paid (weavers).
CREATE OR REPLACE FUNCTION public.fn_employee_weekly_wages(p_from date, p_to date, p_employee bigint DEFAULT NULL::bigint)
 RETURNS TABLE(employee_id bigint, full_name text, emp_code text, role text, basis text, status text, week_start date, earned numeric, metres numeric, same_day numeric, advance numeric, settlement numeric, adjustment numeric, loan_deducted numeric, extra_work numeric, entries bigint)
 LANGUAGE sql
 STABLE
AS $function$
  -- One row per employee per wage week (Monday-start). earned = weavers'
  -- shift-log wage; amounts are gross, loan_deducted is the withheld part.
  WITH w AS (
    SELECT we.employee_id,
           date_trunc('week', COALESCE(we.period_start, we.pay_date))::date AS wk,
           SUM(we.amount) FILTER (WHERE we.kind = 'same_day')   AS same_day,
           SUM(we.amount) FILTER (WHERE we.kind = 'advance')    AS advance,
           SUM(we.amount) FILTER (WHERE we.kind = 'settlement') AS settlement,
           SUM(we.amount) FILTER (WHERE we.kind = 'adjustment') AS adjustment,
           SUM(we.amount) FILTER (WHERE we.kind = 'extra_work') AS extra_work,
           SUM(COALESCE(we.loan_deduction, 0))                   AS loan_deducted,
           COUNT(*) AS entries
      FROM wage_entry we
     WHERE COALESCE(we.period_start, we.pay_date) BETWEEN date_trunc('week', p_from)::date AND p_to
       AND (p_employee IS NULL OR we.employee_id = p_employee)
     GROUP BY 1, 2
  ), s AS (
    SELECT x.employee_id, date_trunc('week', sl.log_date)::date AS wk,
           SUM(x.metres_woven * COALESCE(sl.rate_per_m, l.default_rate_per_m, 0)) AS earned,
           SUM(COALESCE(x.counted_metres, x.metres_woven)) AS metres
      FROM production_shift_log sl
      JOIN production_shift_log_weaver x ON x.shift_log_id = sl.id
      LEFT JOIN loom l ON l.id = sl.loom_id
     WHERE sl.log_date BETWEEN date_trunc('week', p_from)::date AND p_to
       AND (p_employee IS NULL OR x.employee_id = p_employee)
     GROUP BY 1, 2
  ), k AS (
    SELECT employee_id, wk FROM w UNION SELECT employee_id, wk FROM s
  )
  SELECT e.id, e.full_name, e.code, e.role, e.wage_alloc_basis::text, e.status::text,
         k.wk,
         ROUND(s.earned, 2), ROUND(s.metres, 2),
         COALESCE(w.same_day, 0), COALESCE(w.advance, 0), COALESCE(w.settlement, 0),
         COALESCE(w.adjustment, 0), COALESCE(w.loan_deducted, 0), COALESCE(w.extra_work, 0),
         COALESCE(w.entries, 0)
    FROM k
    JOIN employee e ON e.id = k.employee_id
    LEFT JOIN w ON w.employee_id = k.employee_id AND w.wk = k.wk
    LEFT JOIN s ON s.employee_id = k.employee_id AND s.wk = k.wk
   ORDER BY e.full_name, k.wk;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_employee_weekly_wages(date, date, bigint) TO authenticated, service_role;
