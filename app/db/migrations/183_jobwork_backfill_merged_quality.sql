-- 183_jobwork_backfill_merged_quality.sql
--
-- Migration 179 backfilled jobwork_cost_per_m on every invoice_line
-- whose description had a single fabric_quality.code (regex match).
-- Legacy free-text lines like "Jobwork weaving - 20'S DHOTIES" stayed
-- NULL because no single quality matches by code.
--
-- However, these descriptions DO match a `merged_name` on
-- `fabric_quality` (e.g. "20'S DHOTIES" is the merged group covering
-- FQ-0001..FQ-0005). For those lines, the right cost to snapshot is
-- the AVERAGE of pick_cost_per_m across the merged group members.
--
-- This migration:
--   1. Finds every invoice_line where the parent invoice's doc_type
--      is 'jobwork_invoice' AND jobwork_cost_per_m is NULL AND the
--      description's text after "Jobwork weaving - " matches one or
--      more fabric_quality.merged_name rows (is_merged = true).
--   2. Sets jobwork_cost_per_m to the AVG(pick_cost_per_m) across
--      that merged group.
--   3. Leaves fabric_quality_id NULL on those rows because there's
--      no single owner quality — the merged group has multiple
--      members. The Period P&L cost still computes correctly from
--      jobwork_cost_per_m × quantity regardless of FK presence.
--
-- Idempotent: only updates rows where jobwork_cost_per_m is currently
-- NULL.

BEGIN;

WITH targets AS (
  SELECT
    il.id AS line_id,
    REGEXP_REPLACE(il.description, '^Jobwork weaving - ', '') AS merged_name_guess
  FROM public.invoice_line il
  JOIN public.invoice inv ON inv.id = il.invoice_id
  WHERE il.jobwork_cost_per_m IS NULL
    AND inv.doc_type = 'jobwork_invoice'
    AND inv.status NOT IN ('draft', 'cancelled')
),
group_cost AS (
  SELECT
    t.line_id,
    AVG(fq.pick_cost_per_m)::numeric(12,2) AS avg_cost
  FROM targets t
  JOIN public.fabric_quality fq
    ON fq.merged_name = t.merged_name_guess
   AND fq.is_merged = true
   AND fq.pick_cost_per_m IS NOT NULL
  GROUP BY t.line_id
)
UPDATE public.invoice_line il
SET jobwork_cost_per_m = group_cost.avg_cost
FROM group_cost
WHERE il.id = group_cost.line_id;

COMMIT;
