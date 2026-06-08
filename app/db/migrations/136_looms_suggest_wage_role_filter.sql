-- 136_looms_suggest_wage_role_filter.sql
-- fn_looms_calibration_suggest now accepts p_wage_roles text[] (default
-- mill-floor roles) so office/sales salaries don't inflate per-metre
-- overhead in True Cost. Cast e.role::text because employee.role is an
-- enum, not text.

CREATE OR REPLACE FUNCTION public.fn_looms_calibration_suggest(
  p_days_back integer DEFAULT 30,
  p_wage_roles text[] DEFAULT ARRAY['weaver','fitter','folder','winder','mistry','helper','supervisor']
)
RETURNS TABLE (
  power_per_m numeric, labour_per_m numeric, maintenance_per_m numeric, insurance_per_m numeric,
  metres numeric, period_from date, period_to date
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
  win AS (SELECT (CURRENT_DATE - (p_days_back || ' days')::interval)::date AS from_d, CURRENT_DATE AS to_d),
  metres_cte AS (
    SELECT COALESCE(SUM(produced_m), 0)::numeric AS m
    FROM public.production_batch
    WHERE outsource_order_id IS NULL AND end_date IS NOT NULL
      AND end_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  eb_total AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS a
    FROM public.bank_entry be JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status='active' AND be.direction='out' AND bc.code='EB'
      AND be.entry_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  maint_bank AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS a
    FROM public.bank_entry be JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status='active' AND be.direction='out' AND bc.code='MAINTENANCE'
      AND be.entry_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  ins_bank AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS a
    FROM public.bank_entry be JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status='active' AND be.direction='out' AND bc.code='INSURANCE'
      AND be.entry_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  wages AS (
    SELECT COALESCE(SUM(we.amount), 0)::numeric AS a
    FROM public.wage_entry we
    LEFT JOIN public.employee e ON e.id = we.employee_id
    WHERE we.pay_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
      AND (
        cardinality(p_wage_roles) = 0
        OR e.role IS NULL
        OR e.role::text = ANY (p_wage_roles)
      )
  ),
  maint_exp AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS a FROM public.expense_entry
    WHERE pay_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
      AND category ~* '(maintenance|maintainence|repair|spare)'
  ),
  ins_exp AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS a FROM public.expense_entry
    WHERE pay_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
      AND category ~* '(insurance|premium)'
  )
SELECT
  CASE WHEN m.m > 0 THEN (eb.a / m.m)::numeric(14,4)  ELSE NULL END,
  CASE WHEN m.m > 0 THEN (w.a  / m.m)::numeric(14,4)  ELSE NULL END,
  CASE WHEN m.m > 0 THEN ((mb.a + me.a) / m.m)::numeric(14,4) ELSE NULL END,
  CASE WHEN m.m > 0 THEN ((ib.a + ie.a) / m.m)::numeric(14,4) ELSE NULL END,
  m.m, win.from_d, win.to_d
FROM win, metres_cte m, eb_total eb, maint_bank mb, ins_bank ib, wages w, maint_exp me, ins_exp ie;
$$;

COMMENT ON FUNCTION public.fn_looms_calibration_suggest(integer, text[]) IS
  'Suggests ₹/m for LOOMS Calibration. Wages filtered to mill-floor roles by default so office/sales salaries do not inflate per-metre overhead.';
