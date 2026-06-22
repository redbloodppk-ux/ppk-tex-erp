-- 218_wages_expenses_source_ledger.sql
--
-- Wages and expenses were single-entry: each row tagged only the EXPENSE
-- account it rolls into (target_ledger_id → WEAVER WAGES / OFFICE EXPENSES)
-- but never recorded WHICH cash/bank account paid for it. As a result the
-- CASH ledger only ever received debits (receipts + bank-to-cash transfers)
-- and never the matching credits when that cash was spent on wages/expenses,
-- so its running balance only climbed.
--
-- This migration adds the funding (paid-from) side:
--   1. source_ledger_id columns on wage_entry + expense_entry, FK to ledger.
--   2. BEFORE INSERT triggers default source_ledger_id to the CASH ledger
--      when the caller doesn't pass one (the dominant case for this shop).
--   3. Backfill: every existing wage/expense row is stamped paid-from CASH.
--
-- The Ledger View then projects each wage/expense as a CREDIT (outflow) on
-- its source ledger, so CASH finally shows money going out and its balance
-- reflects real cash on hand.

BEGIN;

-- 1. source_ledger_id columns
ALTER TABLE public.wage_entry
  ADD COLUMN IF NOT EXISTS source_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entry
  ADD COLUMN IF NOT EXISTS source_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wage_entry_source_ledger    ON public.wage_entry(source_ledger_id);
CREATE INDEX IF NOT EXISTS idx_expense_entry_source_ledger ON public.expense_entry(source_ledger_id);

COMMENT ON COLUMN public.wage_entry.source_ledger_id IS
  'Cash / bank account this wage was paid from. Defaults to CASH via fn_wage_entry_default_source trigger. Shows as a Credit on that ledger in the Ledger View.';
COMMENT ON COLUMN public.expense_entry.source_ledger_id IS
  'Cash / bank account this expense was paid from. Defaults to CASH via fn_expense_entry_default_source trigger. Shows as a Credit on that ledger in the Ledger View.';

-- 2. Default-on-insert triggers → CASH
CREATE OR REPLACE FUNCTION public.fn_wage_entry_default_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_ledger_id bigint;
BEGIN
  IF NEW.source_ledger_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT l.id INTO v_ledger_id
    FROM public.ledger l
    JOIN public.ledger_type lt ON lt.id = l.type_id
   WHERE lt.name = 'CASH'
   ORDER BY l.id
   LIMIT 1;
  NEW.source_ledger_id := v_ledger_id;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.fn_expense_entry_default_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_ledger_id bigint;
BEGIN
  IF NEW.source_ledger_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT l.id INTO v_ledger_id
    FROM public.ledger l
    JOIN public.ledger_type lt ON lt.id = l.type_id
   WHERE lt.name = 'CASH'
   ORDER BY l.id
   LIMIT 1;
  NEW.source_ledger_id := v_ledger_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_wage_entry_default_source    ON public.wage_entry;
DROP TRIGGER IF EXISTS trg_expense_entry_default_source ON public.expense_entry;

CREATE TRIGGER trg_wage_entry_default_source
  BEFORE INSERT ON public.wage_entry
  FOR EACH ROW EXECUTE FUNCTION public.fn_wage_entry_default_source();

CREATE TRIGGER trg_expense_entry_default_source
  BEFORE INSERT ON public.expense_entry
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_entry_default_source();

-- 3. Backfill existing rows → CASH
UPDATE public.wage_entry
   SET source_ledger_id = (
     SELECT l.id FROM public.ledger l
       JOIN public.ledger_type lt ON lt.id = l.type_id
      WHERE lt.name = 'CASH'
      ORDER BY l.id
      LIMIT 1
   )
 WHERE source_ledger_id IS NULL;

UPDATE public.expense_entry
   SET source_ledger_id = (
     SELECT l.id FROM public.ledger l
       JOIN public.ledger_type lt ON lt.id = l.type_id
      WHERE lt.name = 'CASH'
      ORDER BY l.id
      LIMIT 1
   )
 WHERE source_ledger_id IS NULL;

COMMIT;
