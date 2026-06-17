-- 189_variance_from_fabric_receipts.sql
--
-- Variance Dashboard's "by batch" table was empty because it required
-- production_batch rows — a workflow PPK TEX never adopted. But every
-- fabric_receipt_item already IS a finished batch from a costing
-- perspective: it captures the quality, the produced metres / pieces,
-- and the date the fabric was received. The mill records these on
-- every DC. So we treat fabric_receipt_item as the synthetic batch
-- source instead.
--
-- Both views now share the same row source so the per-quality
-- roll-up == the SUM of its batches, which wasn't true with the
-- previous mixed sources (invoice_line for quality, production_batch
-- for batch).
--
-- Mapping:
--   batch_id            = fri.id
--   batch_code          = fr.code            (RC/26-27/NNNN)
--   end_date            = fr.receipt_date
--   costing_id          = fq.costing_id      (via fabric_quality)
--   produced_m          = received_metres + (no_of_pieces × towelLength
--                          if entry_mode='pcs' and quality is towel)
--   planned ₹/m         = costing_master.quoted_cost_per_m (frozen)
--   actual ₹/m          = v_costing_two_cost.true_cost_per_m (live)
--   variance/m          = actual − planned
--   variance %          = variance/m ÷ planned × 100
--   total variance ₹    = variance/m × produced_m
--
-- Receipt items whose fabric_quality is not linked to a costing
-- (fabric_quality.costing_id IS NULL) are SKIPPED — there's nothing to
-- compare against. As soon as the operator links those qualities on
-- the Fabric Quality form, they start appearing here automatically.

BEGIN;

DROP VIEW IF EXISTS v_variance_by_batch   CASCADE;
DROP VIEW IF EXISTS v_variance_by_quality CASCADE;

-- Helper CTE pattern reused below. Inlined into each view because PG
-- can't share CTEs across view definitions.

CREATE VIEW v_variance_by_batch
WITH (security_invoker=on)
AS
SELECT
  fri.id                                     AS batch_id,
  fr.code                                    AS batch_code,
  fq.costing_id                              AS costing_id,
  cm.quality_code                            AS quality_code,
  cm.quality_name                            AS quality_name,
  /* Produced metres: receipt metres + (pieces × towelLength) when
     the operator entered pieces for a towel quality. */
  (
    COALESCE(fri.received_metres, 0)
    + CASE
        WHEN COALESCE(fri.entry_mode, '') = 'pcs'
         AND COALESCE(fri.no_of_pieces, 0) > 0
         AND cm.fabric_type = 'towel'
         AND (cm.calc_snapshot->>'towelLength') IS NOT NULL
         AND (cm.calc_snapshot->>'towelLength')::numeric > 0
        THEN COALESCE(fri.no_of_pieces, 0) * (cm.calc_snapshot->>'towelLength')::numeric
        ELSE 0
      END
  )::numeric(14,2)                           AS produced_m,
  0::numeric(14,2)                           AS rejected_m,
  NULL::date                                 AS start_date,
  fr.receipt_date                            AS end_date,
  /* Planned ₹/m */
  cm.quoted_cost_per_m::numeric(14,4)        AS planned_true_per_m,
  NULL::numeric(14,4)                        AS planned_warp_per_m,
  NULL::numeric(14,4)                        AS planned_weft_per_m,
  NULL::numeric(14,4)                        AS planned_pick_per_m,
  cm.sizing_cost_per_m::numeric(14,4)        AS planned_sizing_per_m,
  /* Actual ₹/m — live from v_costing_two_cost. */
  tc.true_cost_per_m::numeric(14,4)          AS actual_true_per_m,
  NULL::numeric(14,4)                        AS actual_warp_per_m,
  NULL::numeric(14,4)                        AS actual_weft_per_m,
  NULL::numeric(14,4)                        AS actual_pick_per_m,
  NULL::numeric(14,4)                        AS actual_sizing_per_m,
  (tc.true_cost_per_m - cm.quoted_cost_per_m)::numeric(14,4) AS variance_per_m,
  CASE
    WHEN cm.quoted_cost_per_m IS NULL OR cm.quoted_cost_per_m = 0 THEN NULL
    ELSE ((tc.true_cost_per_m - cm.quoted_cost_per_m)
            / cm.quoted_cost_per_m * 100)::numeric(8,2)
  END                                        AS variance_pct,
  ((tc.true_cost_per_m - cm.quoted_cost_per_m)
    * (
        COALESCE(fri.received_metres, 0)
        + CASE
            WHEN COALESCE(fri.entry_mode, '') = 'pcs'
             AND COALESCE(fri.no_of_pieces, 0) > 0
             AND cm.fabric_type = 'towel'
             AND (cm.calc_snapshot->>'towelLength') IS NOT NULL
             AND (cm.calc_snapshot->>'towelLength')::numeric > 0
            THEN COALESCE(fri.no_of_pieces, 0) * (cm.calc_snapshot->>'towelLength')::numeric
            ELSE 0
          END
      )
  )::numeric(14,2)                           AS total_variance_inr
FROM fabric_receipt_item fri
JOIN fabric_receipt fr ON fr.id = fri.receipt_id
JOIN fabric_quality fq ON fq.id = fri.fabric_quality_id
JOIN costing_master cm ON cm.id = fq.costing_id
LEFT JOIN v_costing_two_cost tc ON tc.id = cm.id
WHERE fq.costing_id IS NOT NULL;

COMMENT ON VIEW v_variance_by_batch IS
  'Per-batch (= per fabric_receipt_item) planned vs actual cost-per-m. Planned = costing_master.quoted_cost_per_m (frozen). Actual = v_costing_two_cost.true_cost_per_m (live). Produced m converts towel pieces via calc_snapshot.towelLength. Receipt items not linked to a costing (via fabric_quality.costing_id) are skipped. Migration 189 replaces the production_batch-based view that PPK TEX never used.';

CREATE VIEW v_variance_by_quality
WITH (security_invoker=on)
AS
WITH per_item AS (
  SELECT
    cm.id                                    AS costing_id,
    cm.quality_code,
    cm.quality_name,
    cm.quoted_cost_per_m,
    tc.true_cost_per_m,
    cm.sizing_cost_per_m,
    fr.receipt_date,
    (
      COALESCE(fri.received_metres, 0)
      + CASE
          WHEN COALESCE(fri.entry_mode, '') = 'pcs'
           AND COALESCE(fri.no_of_pieces, 0) > 0
           AND cm.fabric_type = 'towel'
           AND (cm.calc_snapshot->>'towelLength') IS NOT NULL
           AND (cm.calc_snapshot->>'towelLength')::numeric > 0
          THEN COALESCE(fri.no_of_pieces, 0) * (cm.calc_snapshot->>'towelLength')::numeric
          ELSE 0
        END
    ) AS produced_m
  FROM fabric_receipt_item fri
  JOIN fabric_receipt fr ON fr.id = fri.receipt_id
  JOIN fabric_quality fq ON fq.id = fri.fabric_quality_id
  JOIN costing_master cm ON cm.id = fq.costing_id
  LEFT JOIN v_costing_two_cost tc ON tc.id = cm.id
  WHERE fq.costing_id IS NOT NULL
)
SELECT
  quality_code,
  MAX(quality_name)                          AS quality_name,
  SUM(produced_m)::numeric(14,2)             AS produced_m,
  COUNT(*)::integer                          AS batch_count,
  MAX(quoted_cost_per_m)::numeric(14,4)      AS planned_true_per_m,
  NULL::numeric(14,4)                        AS planned_warp_per_m,
  NULL::numeric(14,4)                        AS planned_weft_per_m,
  NULL::numeric(14,4)                        AS planned_pick_per_m,
  MAX(sizing_cost_per_m)::numeric(14,4)      AS planned_sizing_per_m,
  MAX(true_cost_per_m)::numeric(14,4)        AS actual_true_per_m,
  NULL::numeric(14,4)                        AS actual_warp_per_m,
  NULL::numeric(14,4)                        AS actual_weft_per_m,
  NULL::numeric(14,4)                        AS actual_pick_per_m,
  NULL::numeric(14,4)                        AS actual_sizing_per_m,
  (MAX(true_cost_per_m) - MAX(quoted_cost_per_m))::numeric(14,4) AS variance_per_m,
  CASE
    WHEN MAX(quoted_cost_per_m) IS NULL OR MAX(quoted_cost_per_m) = 0 THEN NULL
    ELSE ((MAX(true_cost_per_m) - MAX(quoted_cost_per_m))
            / MAX(quoted_cost_per_m) * 100)::numeric(8,2)
  END                                        AS variance_pct,
  ((MAX(true_cost_per_m) - MAX(quoted_cost_per_m)) * SUM(produced_m))::numeric(14,2)
                                             AS total_variance_inr
FROM per_item
GROUP BY quality_code
HAVING SUM(produced_m) > 0;

COMMENT ON VIEW v_variance_by_quality IS
  'Quality-rolled-up planned vs actual cost-per-m. Same source as v_variance_by_batch (fabric_receipt_item) so the rollup equals SUM(batches) exactly. Migration 189.';

GRANT SELECT ON v_variance_by_batch   TO authenticated;
GRANT SELECT ON v_variance_by_quality TO authenticated;

COMMIT;
