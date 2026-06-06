-- 117_backfill_invoice_round_off.sql
--
-- Policy update: every invoice bill total is now rounded to the
-- nearest whole rupee, with the paise swing captured in round_off.
-- This migration applies that policy to every existing invoice row
-- where round_off hasn't already been recorded.
--
-- The rule:
--
--     raw_total       = taxable_value + cgst + sgst + igst
--     new_total       = ROUND(raw_total)               -- whole rupees
--     new_round_off   = new_total - raw_total          -- paise swing
--
-- Rows that already carry a non-zero round_off are LEFT ALONE — that
-- means the operator (or a previous run of this migration) has
-- already accepted the rounded figure, and we don't want to disturb
-- their numbers a second time.

BEGIN;

WITH src AS (
  SELECT
    id,
    COALESCE(taxable_value, 0)::numeric
      + COALESCE(cgst_amount, 0)::numeric
      + COALESCE(sgst_amount, 0)::numeric
      + COALESCE(igst_amount, 0)::numeric AS raw_total
  FROM public.invoice
  WHERE COALESCE(round_off, 0) = 0
)
UPDATE public.invoice AS i
SET
  -- New rounded total. Banker's rounding isn't important here — half
  -- rupees are vanishingly rare on real bills, and Postgres ROUND
  -- rounds half away from zero by default which matches the operator's
  -- intuition (₹100.50 → ₹101).
  total     = ROUND(src.raw_total),
  round_off = ROUND(src.raw_total) - src.raw_total
FROM src
WHERE i.id = src.id
  -- Only nudge rows where the rounding actually changes something.
  AND src.raw_total <> ROUND(src.raw_total);

COMMIT;
