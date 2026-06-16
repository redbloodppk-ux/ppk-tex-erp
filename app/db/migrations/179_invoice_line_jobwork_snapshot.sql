-- 179_invoice_line_jobwork_snapshot.sql
-- Snapshot the per-metre jobwork cost onto each jobwork invoice line at
-- save time so historical P&L stays correct when fabric_quality.pick_cost_per_m
-- changes later. Adds fabric_quality_id (FK) + jobwork_cost_per_m (numeric),
-- and best-effort backfills existing jobwork bills by parsing the description.

ALTER TABLE public.invoice_line
  ADD COLUMN IF NOT EXISTS fabric_quality_id  bigint REFERENCES public.fabric_quality(id),
  ADD COLUMN IF NOT EXISTS jobwork_cost_per_m numeric(12,2);

CREATE INDEX IF NOT EXISTS idx_invoice_line_fabric_quality
  ON public.invoice_line (fabric_quality_id);

COMMENT ON COLUMN public.invoice_line.fabric_quality_id IS
  'FK to fabric_quality. Populated for jobwork_invoice lines so cost can be tied back to a master row.';
COMMENT ON COLUMN public.invoice_line.jobwork_cost_per_m IS
  'Point-in-time snapshot of fabric_quality.pick_cost_per_m at save time. Used as COGS for jobwork P&L.';

-- Backfill: for every invoice_line on a jobwork_invoice whose description
-- matches "Jobwork weaving - {fq_code}..." and {fq_code} resolves to a
-- known fabric_quality row, copy the current pick_cost_per_m as the
-- historical snapshot. Lines with non-standard descriptions (legacy
-- free-text like "20'S DHOTIES") are left untouched.
WITH parsed AS (
  SELECT
    il.id AS line_id,
    -- Pull the token immediately after "Jobwork weaving - " up to the next
    -- space or "(". Matches both DOBBY-CT-TOWEL-34 and FQ-0001 shapes.
    (regexp_match(il.description, '^Jobwork weaving - ([A-Za-z0-9\-]+)'))[1] AS fq_code
  FROM public.invoice_line il
  JOIN public.invoice inv ON inv.id = il.invoice_id
  WHERE inv.doc_type = 'jobwork_invoice'
)
UPDATE public.invoice_line il
SET
  fabric_quality_id  = fq.id,
  jobwork_cost_per_m = fq.pick_cost_per_m
FROM parsed p
JOIN public.fabric_quality fq ON fq.code = p.fq_code
WHERE il.id = p.line_id
  AND p.fq_code IS NOT NULL;
