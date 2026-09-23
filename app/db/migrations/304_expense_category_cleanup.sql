-- ============================================================================
-- 304: Tidy expense categories.
--
-- PPK, 2026-09-23: "need to find which category spend most" -> "ok do it".
--
-- 1. MERGE SPELLINGS. 91 older entries (May-Aug) carry mixed-case names
--    ("Auto", "Knotting", "Office", ...) while expense_category and every
--    newer entry use UPPER CASE. The Expenses filter matches exactly, so
--    filtering "AUTO" silently missed the "Auto" rows. Every mixed-case name
--    already has an UPPER twin in expense_category, so each row is simply
--    upper-cased. Nothing matches on the exact spelling
--    (fn_looms_calibration_suggest uses ~*, case-insensitive).
--
-- 2. MACHINERY. The new Dropbox, its panels, advance, repair and the new
--    design box (8 entries, Rs 2,58,350, Jun-Aug) were filed under OTHERS,
--    making OTHERS half of all spend. They move to a new MACHINERY category.
--
-- No amount, date or ledger changes: pro-rata batch allocation
-- (v_batch_expense_allocation) and cash movements are unaffected except for
-- the category label.
--
-- UNDO (ids recorded 2026-09-23):
--   MACHINERY -> 'Others' : ids 44,76,77,123,136,139,152,158 (all were 'Others')
--   Mixed-case originals are listed in the 2026-09-23 session; restore with
--   UPDATE expense_entry SET category = '<old>' WHERE id = ...
-- ============================================================================

INSERT INTO public.expense_category (name, is_active)
SELECT 'MACHINERY', true
WHERE NOT EXISTS (SELECT 1 FROM public.expense_category WHERE upper(name) = 'MACHINERY');

UPDATE public.expense_entry
   SET category = 'MACHINERY'
 WHERE upper(category) = 'OTHERS'
   AND notes ~* '(dropbox|design box)';

UPDATE public.expense_entry
   SET category = upper(category)
 WHERE category <> upper(category)
   AND EXISTS (SELECT 1 FROM public.expense_category c WHERE c.name = upper(expense_entry.category));
