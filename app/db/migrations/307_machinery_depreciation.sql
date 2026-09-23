-- ============================================================================
-- 307: Treat MACHINERY as a fixed asset: depreciate it, don't expense it.
--
-- PPK, 2026-09-23: "ok make it as how real account do".
--
-- Before: the whole Rs 2,58,350 Dropbox / design box purchase was a factory
-- expense in the P&L of the months it was paid.
-- Now:    it is capital. The P&L carries only DEPRECIATION - 15% a year on
--         the written-down value (Income Tax rate for plant & machinery),
--         accrued day by day from each payment's pay_date.
--
-- Depreciation for a period [from, to] on an entry of amount A paid on d0:
--     A * ( 0.85^(years from d0 to from) - 0.85^(years from d0 to to+1) )
-- so each full year removes exactly 15% of what was left, and months add up.
--
-- 1. expense_category.depreciation_rate (percent a year). Non-null = capital
--    category. MACHINERY = 15 and also exclude_from_pnl (306), so the
--    purchase itself leaves factory expenses.
-- 2. fn_capital_depreciation(p_from, p_to) returns the depreciation.
-- 3. fn_period_pnl / fn_period_pnl_split add it into factory_expenses (so
--    own/jobwork split, period costs and net profit all follow). The P&L page
--    shows how much of that line is depreciation.
--
-- Not changed: batch costing (305 keeps MACHINERY out), cash book, Expenses.
-- For the tax return your auditor still applies the IT-Act rules (e.g. half
-- rate for machines used under 180 days in the year); this is the
-- management view.
-- ============================================================================

ALTER TABLE public.expense_category
  ADD COLUMN IF NOT EXISTS depreciation_rate numeric
  CHECK (depreciation_rate IS NULL OR (depreciation_rate > 0 AND depreciation_rate < 100));

COMMENT ON COLUMN public.expense_category.depreciation_rate IS
  'Percent per year, written-down-value. Non-null marks a capital (fixed asset) category: entries are depreciated in the P&L via fn_capital_depreciation instead of being expensed.';

UPDATE public.expense_category
   SET depreciation_rate = 15, exclude_from_pnl = true, exclude_from_batch_cost = true
 WHERE upper(name) = 'MACHINERY';

CREATE OR REPLACE FUNCTION public.fn_capital_depreciation(p_from date, p_to date)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
           ee.amount * (
             power(1 - ec.depreciation_rate / 100, GREATEST(p_from - ee.pay_date, 0) / 365.0)
           - power(1 - ec.depreciation_rate / 100, GREATEST(p_to + 1 - ee.pay_date, 0) / 365.0)
           )), 0)::numeric
    FROM public.expense_entry ee
    JOIN public.expense_category ec ON upper(ec.name) = upper(ee.category)
   WHERE ec.depreciation_rate IS NOT NULL
     AND ee.pay_date <= p_to
     AND p_from <= p_to;
$$;

COMMENT ON FUNCTION public.fn_capital_depreciation(date, date) IS
  'Depreciation (WDV, per expense_category.depreciation_rate) charged on capital expense entries between p_from and p_to inclusive.';

DO $$
DECLARE
  fn   text;
  def  text;
  old  text := 'SELECT COALESCE(SUM(amount), 0)::numeric AS amount
    FROM public.expense_entry';
  new  text := 'SELECT (COALESCE(SUM(amount), 0)
            + public.fn_capital_depreciation(p_from, p_to))::numeric AS amount
    FROM public.expense_entry';
BEGIN
  FOREACH fn IN ARRAY ARRAY['fn_period_pnl', 'fn_period_pnl_split'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO STRICT def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn;
    IF (length(def) - length(replace(def, old, ''))) / length(old) <> 1 THEN
      RAISE EXCEPTION '%: expected the expense_entry sub-query exactly once', fn;
    END IF;
    EXECUTE replace(def, old, new);
  END LOOP;
END $$;
