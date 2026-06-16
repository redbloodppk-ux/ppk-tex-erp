-- 185_period_pnl_include_jobwork.sql
-- Wire jobwork (and Direct Purchases) into the non-split fn_period_pnl
-- so its combined-line output matches the *_combined columns of
-- fn_period_pnl_split.
--
-- Changes vs migration 135:
--   • Revenue now also includes invoice rows with doc_type='jobwork_invoice'
--     (taxable_value, same status filter).
--   • COGS now also includes jobwork COGS:
--       SUM(invoice_line.quantity * jobwork_cost_per_m)
--     for jobwork_invoice lines in the window (lines without a snapshot
--     contribute 0 via COALESCE).
--   • Net Profit additionally subtracts Direct Purchases — the same
--     five-source sum from migration 184 (yarn_lot, bobbin_purchase,
--     sizing_job, fabric_purchase, weaving_bill invoices).
--
-- Function signature is preserved — no new columns, no renames.
-- gross_profit still equals revenue − credit_notes − cogs (with jobwork
-- rolled in on both sides of that subtraction).
--
-- Direct Purchases is a cash-basis cost proxy; will double-count with
-- production-batch COGS if both are recorded. See migration 184.

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
  -- Sale-side revenue (tax_invoice, yarn_sale, general_sale)
  rev_sales AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type IN ('tax_invoice', 'yarn_sale', 'general_sale')
  ),
  -- NEW: jobwork-side revenue (jobwork_invoice only — weaving_bill is a
  -- purchase, not a sale; it shows up in Direct Purchases below).
  rev_jw AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type = 'jobwork_invoice'
  ),
  cn AS (
    SELECT COALESCE(SUM(taxable_value), 0)::numeric AS amount
    FROM public.invoice
    WHERE invoice_date BETWEEN p_from AND p_to
      AND status NOT IN ('draft', 'cancelled')
      AND doc_type = 'credit_note'
  ),
  -- Own-production COGS
  cogs_own AS (
    SELECT COALESCE(SUM(produced_m * COALESCE(actual_true_cost_per_m, 0)), 0)::numeric AS amount
    FROM public.production_batch
    WHERE end_date BETWEEN p_from AND p_to
  ),
  -- NEW: jobwork COGS snapshot (mirrors fn_period_pnl_split)
  cogs_jw AS (
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
  -- NEW: Direct Purchases — five-source sum, identical to migration 184.
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
  -- revenue = sales + jobwork
  (rev_sales.amount + rev_jw.amount)::numeric,
  cn.amount,
  -- cogs = own production + jobwork snapshot
  (cogs_own.amount + cogs_jw.amount)::numeric,
  -- gross_profit = revenue − credit_notes − cogs
  (rev_sales.amount + rev_jw.amount - cn.amount - cogs_own.amount - cogs_jw.amount)::numeric,
  wages_cte.amount, exp_cte.amount, bank_exp.amount, bank_inc.amount,
  (wages_cte.amount + exp_cte.amount + bank_exp.amount)::numeric,
  -- net_profit = gross_profit + bank_income − period_costs − direct_purchases
  (rev_sales.amount + rev_jw.amount - cn.amount - cogs_own.amount - cogs_jw.amount
   + bank_inc.amount
   - wages_cte.amount - exp_cte.amount - bank_exp.amount
   - dp.amount)::numeric
FROM rev_sales, rev_jw, cn, cogs_own, cogs_jw,
     wages_cte, exp_cte, bank_exp, bank_inc, dp;
$$;

COMMENT ON FUNCTION public.fn_period_pnl(date, date) IS
  'Period P&L (combined). Revenue = sale invoices + jobwork_invoice taxable. COGS = production_batch true cost + SUM(invoice_line.quantity * jobwork_cost_per_m). Net Profit additionally subtracts Direct Purchases (yarn_lot / bobbin_purchase / sizing_job / fabric_purchase / weaving_bill in window). Equals the *_combined columns of fn_period_pnl_split line-by-line. Balance-sheet items excluded.';
