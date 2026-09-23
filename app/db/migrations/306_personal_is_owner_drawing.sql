-- ============================================================================
-- 306: PERSONAL expenses are the owner's drawings, not business spend.
--
-- PPK, 2026-09-23: "personal expenses is like my wages not business spent".
--
-- 1. New flag expense_category.exclude_from_pnl. PERSONAL gets it, and
--    fn_period_pnl / fn_period_pnl_split stop counting those entries as an
--    operating expense.
-- 2. PERSONAL also gets exclude_from_batch_cost (migration 305), so it is no
--    longer spread over production batches.
--
-- Unchanged: the entries, the Expenses register, and cash movements - the
-- cash really left the drawer, so the cash book still shows it.
--
-- The two P&L functions are patched in place: the single expense_entry
-- sub-query in each gains a NOT EXISTS filter. The DO block fails loudly if
-- the expected text is not found exactly once, so it cannot half-apply.
-- ============================================================================

ALTER TABLE public.expense_category
  ADD COLUMN IF NOT EXISTS exclude_from_pnl boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.expense_category.exclude_from_pnl IS
  'True for owner''s drawings (e.g. PERSONAL): entries are left out of fn_period_pnl / fn_period_pnl_split operating expenses.';

UPDATE public.expense_category
   SET exclude_from_pnl = true, exclude_from_batch_cost = true
 WHERE upper(name) = 'PERSONAL';

DO $$
DECLARE
  fn   text;
  def  text;
  old  text := 'FROM public.expense_entry
    WHERE pay_date BETWEEN p_from AND p_to';
  new  text := 'FROM public.expense_entry
    WHERE pay_date BETWEEN p_from AND p_to
      AND NOT EXISTS (SELECT 1 FROM public.expense_category ec
                       WHERE upper(ec.name) = upper(expense_entry.category)
                         AND ec.exclude_from_pnl)';
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
