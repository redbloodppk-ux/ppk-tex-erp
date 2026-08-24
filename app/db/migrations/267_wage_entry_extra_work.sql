-- 267_wage_entry_extra_work.sql
--
-- A wage kind for extra work: cleaning, oiling the machines, hand knotting
-- bobbins. Requested by PPK, 2026-08-24.
--
-- WHY NOT REUSE 'adjustment'
-- An adjustment is a CORRECTION - the book figure was wrong and this puts
-- it right. Extra work is EARNINGS - the figure was right and this is pay
-- on top for work the weekly salary does not cover. Folding them together
-- would make "what did we pay for cleaning and oiling this month" an
-- unanswerable question, and would leave a correction and a reward looking
-- identical in the ledger a year from now.
--
-- That is the same mistake as attendance `none`, which today means
-- not-scheduled, not-yet-marked AND gone-from-the-job, and cost three
-- separate money bugs in one week. One value, one meaning.
--
-- 'adjustment' stays exactly as it is - one row, Rs 700 on 2026-08-04.
-- Nothing is migrated between the two: that row may well have been a
-- correction, and guessing would be worse than leaving it.

BEGIN;

ALTER TABLE public.wage_entry DROP CONSTRAINT IF EXISTS wage_entry_kind_check;

ALTER TABLE public.wage_entry ADD CONSTRAINT wage_entry_kind_check
  CHECK (kind = ANY (ARRAY[
    'advance'::text,     -- money taken before the settlement
    'settlement'::text,  -- the weekly pay-out
    'adjustment'::text,  -- a CORRECTION to the book figure
    'same_day'::text,    -- paid the same day, loom-shift workers
    'extra_work'::text   -- EARNINGS on top: cleaning, oiling, hand knotting
  ]));

COMMENT ON COLUMN public.wage_entry.kind IS
  'advance | settlement | adjustment | same_day | extra_work. '
  'adjustment corrects a wrong book figure; extra_work is additional pay '
  'earned for work outside the weekly salary (cleaning, oiling, hand '
  'knotting bobbins). Keep them apart. See migration 267.';

COMMIT;
