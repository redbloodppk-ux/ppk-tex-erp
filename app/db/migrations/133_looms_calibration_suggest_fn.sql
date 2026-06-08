-- 133_looms_calibration_suggest_fn.sql
-- fn_looms_calibration_suggest(p_days_back) → suggested ₹/m for each
-- LOOMS Calibration field, computed from the last N days of
-- bank_entry + expense_entry + wage_entry data ÷ in-house produced
-- metres (production_batch.produced_m where outsource_order_id IS NULL).

CREATE OR REPLACE FUNCTION public.fn_looms_calibration_suggest(p_days_back integer DEFAULT 30)
RETURNS TABLE (
  power_per_m       numeric,
  labour_per_m      numeric,
  maintenance_per_m numeric,
  insurance_per_m   numeric,
  metres            numeric,
  period_from       date,
  period_to         date
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
  win AS (
    SELECT (CURRENT_DATE - (p_days_back || ' days')::interval)::date AS from_d,
           CURRENT_DATE                                              AS to_d
  ),
  metres_cte AS (
    SELECT COALESCE(SUM(produced_m), 0)::numeric AS m
    FROM public.production_batch
    WHERE outsource_order_id IS NULL
      AND end_date IS NOT NULL
      AND end_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  eb_total AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS a
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'out' AND bc.code = 'EB'
      AND be.entry_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  maint_bank AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS a
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'out' AND bc.code = 'MAINTENANCE'
      AND be.entry_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  ins_bank AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS a
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'out' AND bc.code = 'INSURANCE'
      AND be.entry_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  wages AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS a
    FROM public.wage_entry
    WHERE pay_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
  ),
  maint_exp AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS a
    FROM public.expense_entry
    WHERE pay_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
      AND category ~* '(maintenance|maintainence|repair|spare)'
  ),
  ins_exp AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS a
    FROM public.expense_entry
    WHERE pay_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
      AND category ~* '(insurance|premium)'
  )
SELECT
  CASE WHEN m.m > 0 THEN (eb.a       / m.m)::numeric(14,4) ELSE NULL END  AS power_per_m,
  CASE WHEN m.m > 0 THEN (w.a        / m.m)::numeric(14,4) ELSE NULL END  AS labour_per_m,
  CASE WHEN m.m > 0 THEN ((mb.a + me.a) / m.m)::numeric(14,4) ELSE NULL END AS maintenance_per_m,
  CASE WHEN m.m > 0 THEN ((ib.a + ie.a) / m.m)::numeric(14,4) ELSE NULL END AS insurance_per_m,
  m.m                                                                       AS metres,
  win.from_d                                                                AS period_from,
  win.to_d                                                                  AS period_to
FROM win, metres_cte m, eb_total eb, maint_bank mb, ins_bank ib, wages w, maint_exp me, ins_exp ie;
$$;

COMMENT ON FUNCTION public.fn_looms_calibration_suggest(integer) IS
  'Suggests ₹/m values for LOOMS Calibration fields based on the last N days of bank_entry + expense_entry + wage_entry data, divided by in-house produced metres.';
