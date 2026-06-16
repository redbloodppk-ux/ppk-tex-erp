-- 184_period_pnl_direct_purchases.sql
-- Adds a "Direct Purchases" line to fn_period_pnl_split.
--
-- Direct Purchases is a cash-basis cost proxy for businesses that don't
-- track production_batch. It double-counts yarn cost if the user ALSO
-- records production batches — pick one method. PPK TEX has zero
-- batches today so this is the only path.
--
-- Sourced from the same five tables that v_purchase_register (migration
-- 175) unions:
--   1. yarn_lot         — total_amount @ received_date
--   2. bobbin_purchase  — total_amount @ purchase_date
--   3. sizing_job       — total_amount @ COALESCE(date_received, date_sent),
--                          status NOT IN ('draft','cancelled')
--   4. fabric_purchase  — total_amount @ received_date,
--                          status NOT IN ('archived','inactive')
--   5. invoice (doc_type='weaving_bill') — total @ invoice_date,
--                          status NOT IN ('draft','cancelled')
--
-- All purchases sit on the own side; direct_purchases_jobwork is always
-- 0 (jobwork uses customer-supplied yarn).
--
-- Three new columns are appended at the END of the RETURNS TABLE list
-- so column-position consumers don't break:
--   direct_purchases_own
--   direct_purchases_jobwork
--   direct_purchases_combined
--
-- direct_purchases_own is subtracted from net_profit_own; combined from
-- net_profit_combined. gross_profit_* is NOT touched — it stays
-- revenue − credit_notes − COGS.

-- Drop first because Postgres refuses to alter the return type of an
-- existing function in place.
DROP FUNCTION IF EXISTS public.fn_period_pnl_split(date, date);

CREATE OR REPLACE FUNCTION public.fn_period_pnl_split(p_from date, p_to date)
RETURNS TABLE (
  period_from date,
  period_to   date,
  own_metres            numeric,
  jobwork_metres        numeric,
  total_metres          numeric,
  own_share             numeric,
  jw_share              numeric,

  revenue_own           numeric,
  revenue_jobwork       numeric,
  revenue_combined      numeric,

  credit_notes_own      numeric,
  credit_notes_jobwork  numeric,
  credit_notes_combined numeric,

  cogs_own              numeric,
  cogs_jobwork          numeric,
  cogs_combined         numeric,

  gross_profit_own      numeric,
  gross_profit_jobwork  numeric,
  gross_profit_combined numeric,

  wages_own             numeric,
  wages_jobwork         numeric,
  wages_combined        numeric,

  factory_expenses_own      numeric,
  factory_expenses_jobwork  numeric,
  factory_expenses_combined numeric,

  bank_expenses_own         numeric,
  bank_expenses_jobwork     numeric,
  bank_expenses_combined    numeric,

  bank_income_own           numeric,
  bank_income_jobwork       numeric,
  bank_income_combined      numeric,

  period_costs_own          numeric,
  period_costs_jobwork      numeric,
  period_costs_combined     numeric,

  net_profit_own            numeric,
  net_profit_jobwork        numeric,
  net_profit_combined       numeric,

  -- NEW (appended at end to preserve column positions of existing
  -- consumers). Direct Purchases is a cash-basis cost proxy for users
  -- who don't record production_batch; double-counts with COGS if both
  -- are tracked.
  direct_purchases_own      numeric,
  direct_purchases_jobwork  numeric,
  direct_purchases_combined numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
  metres AS (
    SELECT
      COALESCE((
        SELECT SUM(produced_m) FROM public.production_batch
        WHERE end_date BETWEEN p_from AND p_to
      ), 0)::numeric AS own_m,
      COALESCE((
        SELECT SUM(delivered_metres) FROM public.jobwork_order
        WHERE delivered_date BETWEEN p_from AND p_to
      ), 0)::numeric AS jw_m
  ),
  shares AS (
    SELECT
      own_m,
      jw_m,
      (own_m + jw_m)                                        AS total_m,
      CASE WHEN (own_m + jw_m) > 0 THEN own_m / (own_m + jw_m) ELSE 1 END AS own_s,
      CASE WHEN (own_m + jw_m) > 0 THEN jw_m  / (own_m + jw_m) ELSE 0 END AS jw_s
    FROM metres
  ),
  rev_own AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type IN ('tax_invoice', 'yarn_sale', 'general_sale')
  ),
  rev_jw AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type IN ('jobwork_invoice', 'weaving_bill')
  ),
  cn AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type = 'credit_note'
  ),
  cogs_cte AS (
    SELECT COALESCE(SUM(produced_m * COALESCE(actual_true_cost_per_m, 0)), 0)::numeric AS amount
    FROM public.production_batch
    WHERE end_date BETWEEN p_from AND p_to
  ),
  jobwork_cogs AS (
    SELECT COALESCE(SUM(il.quantity * COALESCE(il.jobwork_cost_per_m, 0)), 0)::numeric AS amount
    FROM public.invoice_line il
    JOIN public.invoice inv ON inv.id = il.invoice_id
    WHERE inv.doc_type = 'jobwork_invoice'
      AND inv.invoice_date BETWEEN p_from AND p_to
      AND inv.status NOT IN ('draft', 'cancelled')
  ),
  wages_cte AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.wage_entry
    WHERE pay_date BETWEEN p_from AND p_to
  ),
  exp_cte AS (
    SELECT COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.expense_entry
    WHERE pay_date BETWEEN p_from AND p_to
  ),
  bank_exp AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS amount
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'out'
      AND bc.pl_treatment = 'expense'
      AND be.entry_date BETWEEN p_from AND p_to
  ),
  bank_inc AS (
    SELECT COALESCE(SUM(be.amount), 0)::numeric AS amount
    FROM public.bank_entry be
    JOIN public.bank_category bc ON bc.id = be.category_id
    WHERE be.status = 'active' AND be.direction = 'in'
      AND bc.pl_treatment = 'income'
      AND be.entry_date BETWEEN p_from AND p_to
  ),
  -- NEW: Direct Purchases — same five sources as v_purchase_register
  -- (migration 175). All sit on the own side; jobwork = 0.
  dp_yarn AS (
    SELECT COALESCE(SUM(total_amount), 0)::numeric AS amount
    FROM public.yarn_lot
    WHERE received_date BETWEEN p_from AND p_to
      AND total_amount > 0
  ),
  dp_bobbin AS (
    SELECT COALESCE(SUM(total_amount), 0)::numeric AS amount
    FROM public.bobbin_purchase
    WHERE purchase_date BETWEEN p_from AND p_to
      AND total_amount > 0
  ),
  dp_sizing AS (
    SELECT COALESCE(SUM(total_amount), 0)::numeric AS amount
    FROM public.sizing_job
    WHERE COALESCE(date_received, date_sent) BETWEEN p_from AND p_to
      AND status::text NOT IN ('draft', 'cancelled')
      AND total_amount > 0
  ),
  dp_fabric AS (
    SELECT COALESCE(SUM(total_amount), 0)::numeric AS amount
    FROM public.fabric_purchase
    WHERE received_date BETWEEN p_from AND p_to
      AND status::text NOT IN ('archived', 'inactive')
      AND total_amount > 0
  ),
  dp_weaving AS (
    SELECT COALESCE(SUM(total), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND doc_type = 'weaving_bill'
      AND status NOT IN ('draft', 'cancelled')
  ),
  dp AS (
    SELECT (dp_yarn.amount + dp_bobbin.amount + dp_sizing.amount
            + dp_fabric.amount + dp_weaving.amount)::numeric AS amount
    FROM dp_yarn, dp_bobbin, dp_sizing, dp_fabric, dp_weaving
  )
SELECT
  p_from, p_to,
  s.own_m, s.jw_m, s.total_m, s.own_s, s.jw_s,

  -- Revenue (own / jobwork / combined)
  rev_own.amount,
  rev_jw.amount,
  (rev_own.amount + rev_jw.amount)::numeric,

  -- Credit notes (own only — combined = own)
  cn.amount,
  0::numeric,
  cn.amount,

  -- COGS (own production + jobwork snapshot)
  cogs_cte.amount,
  jobwork_cogs.amount,
  (cogs_cte.amount + jobwork_cogs.amount)::numeric,

  -- Gross Profit (NOT affected by Direct Purchases)
  (rev_own.amount - cn.amount - cogs_cte.amount)::numeric,
  (rev_jw.amount - jobwork_cogs.amount)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount - jobwork_cogs.amount)::numeric,

  -- Wages
  (wages_cte.amount * s.own_s)::numeric,
  (wages_cte.amount * s.jw_s)::numeric,
  wages_cte.amount,

  -- Factory Expenses
  (exp_cte.amount * s.own_s)::numeric,
  (exp_cte.amount * s.jw_s)::numeric,
  exp_cte.amount,

  -- Bank Expenses
  (bank_exp.amount * s.own_s)::numeric,
  (bank_exp.amount * s.jw_s)::numeric,
  bank_exp.amount,

  -- Bank Income (own only)
  bank_inc.amount,
  0::numeric,
  bank_inc.amount,

  -- Period Costs
  (wages_cte.amount * s.own_s + exp_cte.amount * s.own_s + bank_exp.amount * s.own_s)::numeric,
  (wages_cte.amount * s.jw_s  + exp_cte.amount * s.jw_s  + bank_exp.amount * s.jw_s )::numeric,
  (wages_cte.amount + exp_cte.amount + bank_exp.amount)::numeric,

  -- Net Profit — now also subtracts Direct Purchases on the own/combined sides
  (rev_own.amount - cn.amount - cogs_cte.amount + bank_inc.amount
     - wages_cte.amount * s.own_s - exp_cte.amount * s.own_s - bank_exp.amount * s.own_s
     - dp.amount)::numeric,
  (rev_jw.amount - jobwork_cogs.amount
     - wages_cte.amount * s.jw_s - exp_cte.amount * s.jw_s - bank_exp.amount * s.jw_s)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount - jobwork_cogs.amount + bank_inc.amount
     - wages_cte.amount - exp_cte.amount - bank_exp.amount
     - dp.amount)::numeric,

  -- Direct Purchases (NEW)
  dp.amount,
  0::numeric,
  dp.amount
FROM shares s, rev_own, rev_jw, cn, cogs_cte, jobwork_cogs,
     wages_cte, exp_cte, bank_exp, bank_inc, dp;
$$;

COMMENT ON FUNCTION public.fn_period_pnl_split(date, date) IS
  'Period P&L split into Own / Jobwork / Combined columns. Shared period costs allocated by metre share. Jobwork COGS = SUM(invoice_line.quantity * jobwork_cost_per_m) for jobwork_invoice lines. Direct Purchases (cash-basis proxy from yarn_lot / bobbin_purchase / sizing_job / fabric_purchase / weaving_bill) is subtracted from net_profit on the own/combined sides but NOT from gross_profit. Will double-count if user also records production_batch — pick one method.';
