-- 220_sizing_job_round_off_backfill.sql
-- The sizing job form rounds charges_amount and total_amount to whole
-- rupees independently (sizing mills invoice in whole-rupee figures),
-- but never set round_off — it stayed at its 0.00 default on every
-- row. v_purchase_register reconstructs GST as
--   (total - round_off) - taxable
-- so with round_off stuck at 0 the CGST/SGST split came out as a
-- whole rupee (e.g. 377.00 / 377.00) instead of the true decimal GST
-- (376.60 / 376.60).
--
-- Backfill round_off for every existing sizing_job row so the
-- reconstruction is exact again. total_amount, charges_amount and
-- amount_paid are untouched — nothing the operator was billed or has
-- paid changes, only the derived GST split shown in reports.

BEGIN;

UPDATE public.sizing_job
SET round_off = (
  total_amount - charges_amount
  - ROUND(charges_amount * COALESCE(gst_pct, 0) / 100.0, 2)
)::numeric(14,2)
WHERE total_amount IS NOT NULL AND charges_amount IS NOT NULL;

COMMIT;
