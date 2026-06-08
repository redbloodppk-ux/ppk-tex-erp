-- 138_period_pnl_split_fn.sql
-- fn_period_pnl_split(p_from, p_to) → single-row P&L split into three columns:
--   *_own       — own-production P&L
--   *_jobwork   — jobwork P&L
--   *_combined  — sum of own + jobwork (matches fn_period_pnl line-by-line)
--
-- Allocation rule: shared period costs (wages, factory_expenses,
-- bank_expenses) are split between own and jobwork by the metre share:
--   own_metres     = SUM(production_batch.produced_m)        in window
--   jobwork_metres = SUM(jobwork_order.delivered_metres)     in window
--   own_share      = own_metres / (own_metres + jobwork_metres)
--   jw_share       = jobwork_metres / (own_metres + jobwork_metres)
-- If total metres = 0, fall back to own_share=1, jw_share=0 so any
-- standalone invoices/expenses still classify cleanly.
--
-- Revenue:
--   own revenue     = invoices doc_type IN ('tax_invoice','yarn_sale','general_sale')
--   jobwork revenue = invoices doc_type IN ('jobwork_invoice','weaving_bill')
-- Credit notes stay on the own side (consistent with fn_period_pnl).
-- COGS is own-only (jobwork uses customer's yarn).
-- Bank income stays on the own side (interest received etc.).

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

  -- COGS (own only)
  cogs_cte.amount,
  0::numeric,
  cogs_cte.amount,

  -- Gross Profit
  (rev_own.amount - cn.amount - cogs_cte.amount)::numeric,
  (rev_jw.amount)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount)::numeric,

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
  (rev_jw.amount
     - wages_cte.amount * s.jw_s - exp_cte.amount * s.jw_s - bank_exp.amount * s.jw_s)::numeric,
  (rev_own.amount + rev_jw.amount - cn.amount - cogs_cte.amount + bank_inc.amount
     - wages_cte.amount - exp_cte.amount - bank_exp.amount)::numeric
FROM shares s, rev_own, rev_jw, cn, cogs_cte, wages_cte, exp_cte, bank_exp, bank_inc;
$$;

COMMENT ON FUNCTION public.fn_period_pnl_split(date, date) IS
  'Period P&L split into Own / Jobwork / Combined columns. Shared period costs allocated by metre share. Combined column equals fn_period_pnl line-by-line.';
