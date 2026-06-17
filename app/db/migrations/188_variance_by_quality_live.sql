-- 188_variance_by_quality_live.sql
--
-- Variance Dashboard was empty because v_variance_by_quality only
-- reads from production_batch — which PPK TEX never populates.
-- Mirror the Profit-by-Quality migration 182/186 pattern instead:
-- compute variance from what IS tracked (invoice_line + the live
-- v_costing_two_cost view).
--
-- New definitions:
--   planned ₹/m = costing_master.quoted_cost_per_m (frozen at save)
--   actual ₹/m  = v_costing_two_cost.true_cost_per_m (live — recomputes
--                  from latest yarn purchase prices via migration 181)
--   produced m  = true invoiced metres per quality (towel-pcs lines
--                  converted via calc_snapshot.towelLength, same as
--                  migration 186 already does in v_quality_margin)
--   variance/m  = actual − planned
--   variance %  = variance/m ÷ planned × 100
--   total inr   = variance/m × produced m
--
-- v_variance_by_batch is preserved at its 146 definition (still
-- returns 0 rows because production_batch is empty) — the page treats
-- the missing batch data as "No finished batches to show yet." which
-- is correct and accurate.

BEGIN;

DROP VIEW IF EXISTS v_variance_by_quality CASCADE;

CREATE VIEW v_variance_by_quality
WITH (security_invoker=on)
AS
WITH lines AS (
  /* True invoiced metres per line — convert towel pcs to metres via
     calc_snapshot.towelLength (same factor used in v_quality_margin). */
  SELECT
    il.costing_id,
    inv.doc_type,
    inv.invoice_date,
    il.quantity * CASE
      WHEN il.uom = 'pcs'
        AND cm.fabric_type = 'towel'
        AND (cm.calc_snapshot->>'towelLength') IS NOT NULL
        AND (cm.calc_snapshot->>'towelLength')::numeric > 0
      THEN (cm.calc_snapshot->>'towelLength')::numeric
      ELSE 1
    END AS true_metres
  FROM invoice_line il
  JOIN invoice inv      ON inv.id = il.invoice_id
  JOIN costing_master cm ON cm.id = il.costing_id
  WHERE il.costing_id IS NOT NULL
    AND inv.status NOT IN ('draft', 'cancelled')
    AND inv.doc_type IN ('tax_invoice', 'general_sale', 'credit_note')
),
volumes AS (
  SELECT
    l.costing_id,
    SUM(CASE
          WHEN l.doc_type = 'credit_note' THEN -l.true_metres
          ELSE l.true_metres
        END)::numeric(14,2) AS produced_m,
    COUNT(*)::integer       AS batch_count,
    MAX(l.invoice_date)     AS last_event_date
  FROM lines l
  GROUP BY l.costing_id
)
SELECT
  cm.quality_code,
  cm.quality_name,
  v.produced_m,
  v.batch_count,
  /* Planned = frozen quoted cost at costing save time. */
  cm.quoted_cost_per_m::numeric(14,4)                              AS planned_true_per_m,
  /* The legacy view exposed warp/weft/pick/sizing planned splits
     separately. We don't have those broken out, so expose NULL — the
     page renders "—" for null. Only sizing_cost_per_m exists as a
     column. */
  NULL::numeric(14,4)                                              AS planned_warp_per_m,
  NULL::numeric(14,4)                                              AS planned_weft_per_m,
  NULL::numeric(14,4)                                              AS planned_pick_per_m,
  cm.sizing_cost_per_m::numeric(14,4)                              AS planned_sizing_per_m,
  /* Actual = live true cost from v_costing_two_cost (recomputes
     from latest yarn purchase prices). */
  tc.true_cost_per_m::numeric(14,4)                                AS actual_true_per_m,
  NULL::numeric(14,4)                                              AS actual_warp_per_m,
  NULL::numeric(14,4)                                              AS actual_weft_per_m,
  NULL::numeric(14,4)                                              AS actual_pick_per_m,
  NULL::numeric(14,4)                                              AS actual_sizing_per_m,
  /* Variance per metre + percentage + total INR. NULL when either
     side missing or when produced_m = 0. */
  (tc.true_cost_per_m - cm.quoted_cost_per_m)::numeric(14,4)       AS variance_per_m,
  CASE
    WHEN cm.quoted_cost_per_m IS NULL OR cm.quoted_cost_per_m = 0 THEN NULL
    ELSE ((tc.true_cost_per_m - cm.quoted_cost_per_m)
            / cm.quoted_cost_per_m * 100)::numeric(8,2)
  END                                                              AS variance_pct,
  ((tc.true_cost_per_m - cm.quoted_cost_per_m)
     * v.produced_m)::numeric(14,2)                                AS total_variance_inr
FROM costing_master cm
JOIN volumes v             ON v.costing_id = cm.id
LEFT JOIN v_costing_two_cost tc ON tc.id = cm.id
WHERE v.produced_m <> 0;

COMMENT ON VIEW v_variance_by_quality IS
  'Per-quality planned vs actual cost-per-m. Planned = costing_master.quoted_cost_per_m (frozen). Actual = v_costing_two_cost.true_cost_per_m (live from latest yarn prices). Volumes = true invoiced metres (towel pcs converted via calc_snapshot.towelLength). Migration 188 replaces the production-batch-based view with this invoice-driven version so the dashboard works without batch tracking.';

GRANT SELECT ON v_variance_by_quality TO authenticated;

COMMIT;
