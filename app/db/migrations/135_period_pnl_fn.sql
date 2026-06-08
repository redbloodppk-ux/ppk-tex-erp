-- 135_period_pnl_fn.sql
-- fn_period_pnl(p_from, p_to) → single-row P&L for any window.
--
-- Lines:
--   revenue          — tax/sales/yarn-sale invoice.taxable_value in window
--   credit_notes     — credit_note invoices in window (negate from revenue)
--   cogs             — production_batch.actual_true_cost_per_m × produced_m
--                      for batches ending in the window
--   wages            — wage_entry total in window
--   factory_expenses — expense_entry total in window
--   bank_expenses    — bank_entry rows where category.pl_treatment='expense'
--   bank_income      — bank_entry rows where category.pl_treatment='income'
--
-- Balance-sheet items (cash withdrawal, loan principal, GST payment,
-- loan disbursement, cash deposit) are EXCLUDED — they don't affect
-- profit, only the balance sheet.
--
--   gross_profit = revenue − credit_notes − cogs
--   period_costs = wages + factory_expenses + bank_expenses
--   net_profit   = gross_profit + bank_income − period_costs

CREATE OR REPLACE FUNCTION public.fn_period_pnl(p_from date, p_to date)
RETURNS TABLE (
  period_from date,
  period_to   date,
  revenue          numeric,
  credit_notes     numeric,
  cogs             numeric,
  gross_profit     numeric,
  wages            numeric,
  factory_expenses numeric,
  bank_expenses    numeric,
  bank_income      numeric,
  period_costs     numeric,
  net_profit       numeric
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
  rev AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type IN ('tax_invoice', 'yarn_sale', 'general_sale')
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
  rev.amount, cn.amount, cogs_cte.amount,
  (rev.amount - cn.amount - cogs_cte.amount)::numeric,
  wages_cte.amount, exp_cte.amount, bank_exp.amount, bank_inc.amount,
  (wages_cte.amount + exp_cte.amount + bank_exp.amount)::numeric,
  (rev.amount - cn.amount - cogs_cte.amount
   + bank_inc.amount
   - wages_cte.amount - exp_cte.amount - bank_exp.amount)::numeric
FROM rev, cn, cogs_cte, wages_cte, exp_cte, bank_exp, bank_inc;
$$;

COMMENT ON FUNCTION public.fn_period_pnl(date, date) IS
  'Period P&L. Revenue − Credit Notes − COGS = Gross Profit. + Bank Income − Wages − Expenses − Bank expenses (pl_treatment=expense) = Net Profit. Balance-sheet items excluded.';
