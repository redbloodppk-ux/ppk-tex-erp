-- 118_sizing_payments.sql
--
-- Adds a sizing_job link on the public.payment table so payments to
-- sizing mills can be tracked against the same bill that drives the
-- sizing charges (bill_no / bill_date / total_amount on sizing_job).
--
-- The existing payment workflow is:
--   public.payment.invoice_id  → public.invoice(id)
--
-- For sizing we add a parallel link:
--   public.payment.sizing_job_id → public.sizing_job(id)
--
-- A payment row carries either invoice_id OR sizing_job_id (but not
-- both). The application enforces this; we don't add a DB check
-- constraint because legacy rows with invoice_id NULL and no sizing
-- link still need to round-trip cleanly.

BEGIN;

ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS sizing_job_id bigint REFERENCES public.sizing_job(id);

CREATE INDEX IF NOT EXISTS idx_payment_sizing_job_id
  ON public.payment(sizing_job_id)
  WHERE sizing_job_id IS NOT NULL;

COMMENT ON COLUMN public.payment.sizing_job_id IS
  'Optional link to a sizing_job row when this payment was recorded against a sizing mill''s bill. Mutually exclusive with invoice_id (enforced by the application).';

COMMIT;
