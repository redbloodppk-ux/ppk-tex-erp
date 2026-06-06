-- 116_sizing_bill_fields.sql
--
-- The Sizing Job form now doubles as a sizing-bill entry: every job
-- captures the sizing mill's invoice number + invoice date, and the
-- charges are computed off Yarn Used (kg) × rate (was Yarn Sent).
--
-- Two new optional-at-DB-level columns on sizing_job. The application
-- form enforces them as mandatory; legacy rows from before this
-- migration are left NULL.

BEGIN;

ALTER TABLE public.sizing_job
  ADD COLUMN IF NOT EXISTS bill_no   text,
  ADD COLUMN IF NOT EXISTS bill_date date;

-- Helpful index for the Bills tab on /app/sizing — it filters by
-- bill_no IS NOT NULL and orders by bill_date.
CREATE INDEX IF NOT EXISTS idx_sizing_job_bill_date
  ON public.sizing_job(bill_date DESC NULLS LAST)
  WHERE bill_no IS NOT NULL;

COMMENT ON COLUMN public.sizing_job.bill_no   IS 'Sizing mill''s invoice number captured at job creation. Required by the UI.';
COMMENT ON COLUMN public.sizing_job.bill_date IS 'Date on the sizing mill''s invoice. Required by the UI.';

COMMIT;
