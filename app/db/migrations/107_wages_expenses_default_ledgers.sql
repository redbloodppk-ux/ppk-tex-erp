-- 107_wages_expenses_default_ledgers.sql
--
-- Tie every recorded wage to the WEAVER WAGES ledger and every
-- recorded expense to the OFFICE EXPENSES ledger so they show up in
-- the new Ledger View tab.
--
-- Steps:
--   1. Make sure the EXPENSES ledger type exists (the WAGES type was
--      added by migration 105).
--   2. Make sure the two default ledgers exist:
--        WEAVER WAGES    → WAGES    / DIRECT EXPENSES
--        OFFICE EXPENSES → EXPENSES / INDIRECT EXPENSES
--   3. Add target_ledger_id columns to wage_entry and expense_entry
--      so each row can be tagged to a specific ledger (operator can
--      pick a different WAGES- or EXPENSES-type ledger later).
--   4. BEFORE INSERT triggers default target_ledger_id to the matching
--      WEAVER WAGES / OFFICE EXPENSES ledger when the caller doesn't
--      pass one — the dominant case.
--   5. Backfill: any existing wage_entry / expense_entry rows without
--      a target_ledger_id are stamped with the new defaults so they
--      appear in the Ledger View right away.

BEGIN;

-- 1. EXPENSES ledger type
INSERT INTO public.ledger_type (name, active)
SELECT 'EXPENSES', true
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_type WHERE name = 'EXPENSES');

-- 2. Default ledgers
INSERT INTO public.ledger (name, type_id, group_id, active)
SELECT 'WEAVER WAGES',
       (SELECT id FROM public.ledger_type  WHERE name = 'WAGES'),
       (SELECT id FROM public.ledger_group WHERE name = 'DIRECT EXPENSES'),
       true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.ledger l
     JOIN public.ledger_type lt ON lt.id = l.type_id
    WHERE l.name = 'WEAVER WAGES' AND lt.name = 'WAGES'
 );

INSERT INTO public.ledger (name, type_id, group_id, active)
SELECT 'OFFICE EXPENSES',
       (SELECT id FROM public.ledger_type  WHERE name = 'EXPENSES'),
       (SELECT id FROM public.ledger_group WHERE name = 'INDIRECT EXPENSES'),
       true
 WHERE NOT EXISTS (
   SELECT 1 FROM public.ledger l
     JOIN public.ledger_type lt ON lt.id = l.type_id
    WHERE l.name = 'OFFICE EXPENSES' AND lt.name = 'EXPENSES'
 );

-- 3. target_ledger_id columns
ALTER TABLE public.wage_entry
  ADD COLUMN IF NOT EXISTS target_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entry
  ADD COLUMN IF NOT EXISTS target_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wage_entry_target_ledger    ON public.wage_entry(target_ledger_id);
CREATE INDEX IF NOT EXISTS idx_expense_entry_target_ledger ON public.expense_entry(target_ledger_id);

COMMENT ON COLUMN public.wage_entry.target_ledger_id IS
  'Which expense ledger this wage rolls into. Defaults to WEAVER WAGES via fn_wage_entry_default_ledger trigger.';
COMMENT ON COLUMN public.expense_entry.target_ledger_id IS
  'Which expense ledger this entry rolls into. Defaults to OFFICE EXPENSES via fn_expense_entry_default_ledger trigger.';

-- 4. Default-on-insert triggers
CREATE OR REPLACE FUNCTION public.fn_wage_entry_default_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_ledger_id bigint;
BEGIN
  IF NEW.target_ledger_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT l.id INTO v_ledger_id
    FROM public.ledger l
    JOIN public.ledger_type lt ON lt.id = l.type_id
   WHERE lt.name = 'WAGES' AND l.name = 'WEAVER WAGES'
   LIMIT 1;
  NEW.target_ledger_id := v_ledger_id;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.fn_expense_entry_default_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE v_ledger_id bigint;
BEGIN
  IF NEW.target_ledger_id IS NOT NULL THEN RETURN NEW; END IF;
  SELECT l.id INTO v_ledger_id
    FROM public.ledger l
    JOIN public.ledger_type lt ON lt.id = l.type_id
   WHERE lt.name = 'EXPENSES' AND l.name = 'OFFICE EXPENSES'
   LIMIT 1;
  NEW.target_ledger_id := v_ledger_id;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_wage_entry_default_ledger    ON public.wage_entry;
DROP TRIGGER IF EXISTS trg_expense_entry_default_ledger ON public.expense_entry;

CREATE TRIGGER trg_wage_entry_default_ledger
  BEFORE INSERT ON public.wage_entry
  FOR EACH ROW EXECUTE FUNCTION public.fn_wage_entry_default_ledger();

CREATE TRIGGER trg_expense_entry_default_ledger
  BEFORE INSERT ON public.expense_entry
  FOR EACH ROW EXECUTE FUNCTION public.fn_expense_entry_default_ledger();

-- 5. Backfill existing rows
UPDATE public.wage_entry
   SET target_ledger_id = (
     SELECT l.id FROM public.ledger l
       JOIN public.ledger_type lt ON lt.id = l.type_id
      WHERE lt.name = 'WAGES' AND l.name = 'WEAVER WAGES'
      LIMIT 1
   )
 WHERE target_ledger_id IS NULL;

UPDATE public.expense_entry
   SET target_ledger_id = (
     SELECT l.id FROM public.ledger l
       JOIN public.ledger_type lt ON lt.id = l.type_id
      WHERE lt.name = 'EXPENSES' AND l.name = 'OFFICE EXPENSES'
      LIMIT 1
   )
 WHERE target_ledger_id IS NULL;

COMMIT;
