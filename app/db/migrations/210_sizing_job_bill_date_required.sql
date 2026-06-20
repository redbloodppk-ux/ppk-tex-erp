-- 210_sizing_job_bill_date_required.sql
--
-- Make the sizing mill's invoice date mandatory at the database level.
--
-- Why: the Purchase Register keys sizing bills off sj.bill_date (the
-- supplier invoice date) so each bill lands in the correct GST period.
-- The New Sizing Job, full job edit, and bill edit forms all already
-- require this field, but a DB constraint guarantees no sizing job can
-- ever be saved without it, regardless of entry path.
--
-- Safe to apply: every existing sizing_job row already has bill_date
-- populated (verified: 0 nulls).

ALTER TABLE public.sizing_job
  ALTER COLUMN bill_date SET NOT NULL;
