-- 180_period_pnl_jobwork_cost.sql
-- Phase 2 of Fabric Costing: bring jobwork COGS into the P&L.
--
-- Previously, jobwork revenue (JB/WB bills) flowed through with zero
-- cost — gross profit on the jobwork side equalled revenue. Now that
-- each jobwork invoice_line snapshots fabric_quality.pick_cost_per_m as
-- jobwork_cost_per_m (migration 179), we can compute true jobwork COGS
-- as SUM(quantity * jobwork_cost_per_m) and subtract it from jobwork
-- gross/net profit. Lines without a snapshot (legacy, or DCs billed
-- before this feature shipped) contribute 0 cost via COALESCE.
--
-- Only fn_period_pnl_split is updated here. fn_period_pnl (the
-- non-split version) does not surface jobwork revenue, so per the spec
-- it does not need jobwork COGS either.
--
-- Replaces:
--   fn_period_pnl_split — adds cogs_jobwork output column, adjusts
--                          gross/net profit on jobwork + combined.

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
  net_profit_combined       numeric
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
  -- NEW: jobwork COGS — sum of quantity × snapshotted per-metre cost on
  -- every jobwork_invoice line in the window. Lines without a snapshot
  -- (legacy / pre-migration-179) contribute 0 via COALESCE so they
  -- don't drag the cost up artificially. weaving_bill rows are not yet
  -- snapshotted; they fall through at 0 cost (same as before).
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

  -- Gross Profit
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

  -- Net Profit
  (rev_own.amount - cn.amount - cogs_cte.amount + bank_inc.amount
     - wages_cte.amount * s.own_s - exp_cte.amount * s.own_s - bank_exp.amount * s.own_s)::numeric,
  (rev_jw.amount - jobwork_cogs.amount
     - wages_cte.amount * s.jw_s - exp_cte.amount * s.jw_s - bank_exp.amount * s.jw_s)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount - jobwork_cogs.amount + bank_inc.amount
     - wages_cte.amount - exp_cte.amount - bank_exp.amount)::numeric
FROM shares s, rev_own, rev_jw, cn, cogs_cte, jobwork_cogs, wages_cte, exp_cte, bank_exp, bank_inc;
$$;

COMMENT ON FUNCTION public.fn_period_pnl_split(date, date) IS
  'Period P&L split into Own / Jobwork / Combined columns. Shared period costs allocated by metre share. Jobwork COGS = SUM(invoice_line.quantity * jobwork_cost_per_m) for jobwork_invoice lines. Combined column equals fn_period_pnl + jobwork revenue − jobwork COGS.';
