-- 191_looms_suggest_use_fabric_receipts.sql
--
-- LOOMS Calibration's "Suggest" was returning all-NULL per-metre
-- numbers because the metres source was `production_batch.produced_m`
-- and PPK TEX has zero production batches (the operator runs the
-- fabric-receipt flow instead, same gap we already worked around for
-- Variance Dashboard in migration 189).
--
-- Swap the metres source to fabric_receipt_item, filtered to in-house
-- qualities only (LOOMS Calibration's overhead applies to in-house
-- weaving). For towel qualities entered as pieces we convert pcs →
-- metres via fabric_quality.meter_per_pc, same trick used elsewhere.
--
-- All other formulas (wages / EB / maintenance / insurance bucket
-- totals) stay identical.

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
    /* In-house produced metres in the window, derived from fabric
       receipts. received_metres is the primary number; for towel
       qualities billed in pieces we add (pieces × meter_per_pc) so
       the towel inventory isn't undercounted. fabric_quality with
       production_mode='inhouse' only — LOOMS overhead doesn't apply
       to jobwork / outsource. */
    SELECT COALESCE(SUM(
      COALESCE(fri.received_metres, 0)
      + CASE
          WHEN COALESCE(fri.entry_mode, '') = 'pcs'
           AND COALESCE(fri.no_of_pieces, 0) > 0
           AND fq.meter_per_pc IS NOT NULL
           AND fq.meter_per_pc > 0
          THEN fri.no_of_pieces * fq.meter_per_pc
          ELSE 0
        END
    ), 0)::numeric AS m
    FROM public.fabric_receipt_item fri
    JOIN public.fabric_receipt fr  ON fr.id = fri.receipt_id
    JOIN public.fabric_quality  fq ON fq.id = fri.fabric_quality_id
    WHERE fq.production_mode = 'inhouse'
      AND fr.receipt_date BETWEEN (SELECT from_d FROM win) AND (SELECT to_d FROM win)
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
  CASE WHEN m.m > 0 THEN (eb.a / m.m)::numeric(14,4)             ELSE NULL END,
  CASE WHEN m.m > 0 THEN (w.a  / m.m)::numeric(14,4)             ELSE NULL END,
  CASE WHEN m.m > 0 THEN ((mb.a + me.a) / m.m)::numeric(14,4)    ELSE NULL END,
  CASE WHEN m.m > 0 THEN ((ib.a + ie.a) / m.m)::numeric(14,4)    ELSE NULL END,
  m.m, win.from_d, win.to_d
FROM win, metres_cte m, eb_total eb, maint_bank mb, ins_bank ib, wages w, maint_exp me, ins_exp ie;
$$;

COMMENT ON FUNCTION public.fn_looms_calibration_suggest(integer, text[]) IS
  'Suggests Rs/m for LOOMS Calibration. Metres source = fabric_receipt_item (in-house qualities only); pieces converted via fabric_quality.meter_per_pc. Wages filtered to mill-floor roles by default.';
