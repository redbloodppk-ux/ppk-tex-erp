-- 109_remove_duplicate_office_expenses_ledger.sql
--
-- A duplicate "OFFICE EXPENSES" ledger sneaked in under the WAGES
-- ledger type (alongside the correct one under EXPENSES). When the
-- operator picked OFFICE EXPENSES in the Ledger View dropdown, the
-- WAGES-typed duplicate had zero entries and made the page look
-- empty.
--
-- Drop any OFFICE EXPENSES ledger that is NOT typed EXPENSES. The
-- query is FK-safe: we only delete ledgers with zero references in
-- payment / party / customer / wage_entry / expense_entry. Anything
-- with a stray reference is left alone so deletion never breaks data.

BEGIN;

DELETE FROM public.ledger l
WHERE l.name = 'OFFICE EXPENSES'
  AND l.type_id <> (SELECT id FROM public.ledger_type WHERE name = 'EXPENSES')
  AND NOT EXISTS (SELECT 1 FROM public.payment       WHERE mode_ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.payment       WHERE party_id IN (SELECT id FROM public.party WHERE ledger_id = l.id))
  AND NOT EXISTS (SELECT 1 FROM public.party         WHERE ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.customer      WHERE ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.wage_entry    WHERE target_ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.expense_entry WHERE target_ledger_id = l.id);

-- Same defensive cleanup for any duplicate WEAVER WAGES that may
-- have been typed wrong (e.g. EXPENSES instead of WAGES).
DELETE FROM public.ledger l
WHERE l.name = 'WEAVER WAGES'
  AND l.type_id <> (SELECT id FROM public.ledger_type WHERE name = 'WAGES')
  AND NOT EXISTS (SELECT 1 FROM public.payment       WHERE mode_ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.payment       WHERE party_id IN (SELECT id FROM public.party WHERE ledger_id = l.id))
  AND NOT EXISTS (SELECT 1 FROM public.party         WHERE ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.customer      WHERE ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.wage_entry    WHERE target_ledger_id = l.id)
  AND NOT EXISTS (SELECT 1 FROM public.expense_entry WHERE target_ledger_id = l.id);

COMMIT;
