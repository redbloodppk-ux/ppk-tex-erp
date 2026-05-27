ALTER TABLE public.attendance_entry
  ADD COLUMN IF NOT EXISTS shed_nos text[];
-- Backfill from the legacy single-shed column so old rows keep working.
UPDATE public.attendance_entry
   SET shed_nos = ARRAY[shed_no]
 WHERE shed_no IS NOT NULL AND (shed_nos IS NULL OR cardinality(shed_nos) = 0);

CREATE INDEX IF NOT EXISTS attendance_entry_shed_nos_gin
  ON public.attendance_entry USING gin (shed_nos);

COMMENT ON COLUMN public.attendance_entry.shed_nos IS
  'Multi-shed coverage for the employee in this shift. Weavers normally have 1 entry; winders may cover several sheds in one shift.';
