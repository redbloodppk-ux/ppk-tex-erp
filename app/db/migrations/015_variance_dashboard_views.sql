-- 015_variance_dashboard_views.sql
-- Variance Dashboard (CORR-R6) - planned vs actual cost-per-metre.
--
-- Two views:
--   v_variance_by_batch    - one row per production_batch.
--                            Compares planned cost (from costing) against
--                            the frozen actuals snapshotted on the batch.
--   v_variance_by_quality  - rolled up per quality_code.
--                            Actual cost-per-m is weighted by produced_m
--                            (so a 5,000 m batch counts 5x a 1,000 m batch).
--
-- Planned source: v_costing_two_cost
--   - true_cost_per_m              (overall planned cost)
--   - warp_cost_per_m              (warp yarn portion)
--   - weft_cost_per_m              (weft yarn portion)
--   - pick_cost_quoted_per_m       (weaving wages portion, market rate)
--   - sizing_cost_per_m            (sizing portion)
--
-- Actual source: production_batch (frozen by CORR-T1 trigger on insert)
--   - actual_true_cost_per_m
--   - actual_warp_cost_per_m
--   - actual_weft_cost_per_m
--   - actual_pick_cost_per_m
--   - actual_sizing_cost_per_m
--
-- Sign convention: variance > 0 means actual EXCEEDED planned (over budget).
-- variance_pct = variance_per_m / planned_per_m * 100.
-- total_variance_inr = variance_per_m * produced_m (negative = savings).
--
-- Only batches with produced_m > 0 are included (drafts skipped).

DROP VIEW IF EXISTS v_variance_by_batch CASCADE;
DROP VIEW IF EXISTS v_variance_by_quality CASCADE;

CREATE VIEW v_variance_by_batch
WITH (security_invoker = on)
AS
SELECT
  pb.id                                                        AS batch_id,
  pb.batch_code,
  pb.costing_id,
  cm.quality_code,
  cm.quality_name,
  pb.produced_m::numeric(14,2)                                 AS produced_m,
  pb.rejected_m::numeric(14,2)                                 AS rejected_m,
  pb.start_date,
  pb.end_date,
  -- Planned (from the saved costing)
  cc.true_cost_per_m::numeric(14,4)                            AS planned_true_per_m,
  cc.warp_cost_per_m::numeric(14,4)                            AS planned_warp_per_m,
  cc.weft_cost_per_m::numeric(14,4)                            AS planned_weft_per_m,
  cc.pick_cost_quoted_per_m::numeric(14,4)                     AS planned_pick_per_m,
  cc.sizing_cost_per_m::numeric(14,4)                          AS planned_sizing_per_m,
  -- Actual (frozen on insert by CORR-T1 trigger)
  pb.actual_true_cost_per_m::numeric(14,4)                     AS actual_true_per_m,
  pb.actual_warp_cost_per_m::numeric(14,4)                     AS actual_warp_per_m,
  pb.actual_weft_cost_per_m::numeric(14,4)                     AS actual_weft_per_m,
  pb.actual_pick_cost_per_m::numeric(14,4)                     AS actual_pick_per_m,
  pb.actual_sizing_cost_per_m::numeric(14,4)                   AS actual_sizing_per_m,
  -- Variance
  (COALESCE(pb.actual_true_cost_per_m, 0) - COALESCE(cc.true_cost_per_m, 0))::numeric(14,4)
                                                               AS variance_per_m,
  CASE
    WHEN COALESCE(cc.true_cost_per_m, 0) = 0 THEN NULL
    ELSE ((COALESCE(pb.actual_true_cost_per_m, 0) - cc.true_cost_per_m)
           / cc.true_cost_per_m * 100)::numeric(8,2)
  END                                                          AS variance_pct,
  ((COALESCE(pb.actual_true_cost_per_m, 0) - COALESCE(cc.true_cost_per_m, 0))
   * pb.produced_m)::numeric(14,2)                             AS total_variance_inr
FROM production_batch pb
JOIN costing_master   cm ON cm.id = pb.costing_id
LEFT JOIN v_costing_two_cost cc ON cc.id = pb.costing_id
WHERE pb.produced_m > 0;

CREATE VIEW v_variance_by_quality
WITH (security_invoker = on)
AS
WITH batch_join AS (
  SELECT
    cm.quality_code,
    cm.quality_name,
    pb.produced_m,
    cc.true_cost_per_m   AS planned_true,
    cc.warp_cost_per_m   AS planned_warp,
    cc.weft_cost_per_m   AS planned_weft,
    cc.pick_cost_quoted_per_m AS planned_pick,
    cc.sizing_cost_per_m AS planned_sizing,
    pb.actual_true_cost_per_m   AS actual_true,
    pb.actual_warp_cost_per_m   AS actual_warp,
    pb.actual_weft_cost_per_m   AS actual_weft,
    pb.actual_pick_cost_per_m   AS actual_pick,
    pb.actual_sizing_cost_per_m AS actual_sizing
  FROM production_batch pb
  JOIN costing_master   cm ON cm.id = pb.costing_id
  LEFT JOIN v_costing_two_cost cc ON cc.id = pb.costing_id
  WHERE pb.produced_m > 0
),
agg AS (
  SELECT
    quality_code,
    MAX(quality_name)                                                 AS quality_name,
    SUM(produced_m)                                                   AS produced_m,
    COUNT(*)                                                          AS batch_count,
    -- Planned = average across the costings used (rounded later)
    AVG(planned_true)                                                 AS planned_true_per_m,
    AVG(planned_warp)                                                 AS planned_warp_per_m,
    AVG(planned_weft)                                                 AS planned_weft_per_m,
    AVG(planned_pick)                                                 AS planned_pick_per_m,
    AVG(planned_sizing)                                               AS planned_sizing_per_m,
    -- Actual = produced_m-weighted average of batch actuals
    SUM(COALESCE(actual_true, 0)   * produced_m) / NULLIF(SUM(produced_m), 0) AS actual_true_per_m,
    SUM(COALESCE(actual_warp, 0)   * produced_m) / NULLIF(SUM(produced_m), 0) AS actual_warp_per_m,
    SUM(COALESCE(actual_weft, 0)   * produced_m) / NULLIF(SUM(produced_m), 0) AS actual_weft_per_m,
    SUM(COALESCE(actual_pick, 0)   * produced_m) / NULLIF(SUM(produced_m), 0) AS actual_pick_per_m,
    SUM(COALESCE(actual_sizing, 0) * produced_m) / NULLIF(SUM(produced_m), 0) AS actual_sizing_per_m,
    -- Total variance in INR = SUM((actual - planned) * produced_m)
    SUM((COALESCE(actual_true, 0) - COALESCE(planned_true, 0)) * produced_m) AS total_variance_inr
  FROM batch_join
  GROUP BY quality_code
)
SELECT
  quality_code,
  quality_name,
  produced_m::numeric(14,2)                          AS produced_m,
  batch_count::integer                               AS batch_count,
  planned_true_per_m::numeric(14,4)                  AS planned_true_per_m,
  planned_warp_per_m::numeric(14,4)                  AS planned_warp_per_m,
  planned_weft_per_m::numeric(14,4)                  AS planned_weft_per_m,
  planned_pick_per_m::numeric(14,4)                  AS planned_pick_per_m,
  planned_sizing_per_m::numeric(14,4)                AS planned_sizing_per_m,
  actual_true_per_m::numeric(14,4)                   AS actual_true_per_m,
  actual_warp_per_m::numeric(14,4)                   AS actual_warp_per_m,
  actual_weft_per_m::numeric(14,4)                   AS actual_weft_per_m,
  actual_pick_per_m::numeric(14,4)                   AS actual_pick_per_m,
  actual_sizing_per_m::numeric(14,4)                 AS actual_sizing_per_m,
  (COALESCE(actual_true_per_m, 0) - COALESCE(planned_true_per_m, 0))::numeric(14,4)
                                                     AS variance_per_m,
  CASE
    WHEN COALESCE(planned_true_per_m, 0) = 0 THEN NULL
    ELSE ((COALESCE(actual_true_per_m, 0) - planned_true_per_m) / planned_true_per_m * 100)::numeric(8,2)
  END                                                AS variance_pct,
  total_variance_inr::numeric(14,2)                  AS total_variance_inr
FROM agg;

COMMENT ON VIEW v_variance_by_batch IS
  'Per-batch planned vs actual cost-per-m. Variance > 0 means actual exceeded plan.';
COMMENT ON VIEW v_variance_by_quality IS
  'Quality-rolled-up planned vs actual cost-per-m, weighted by produced_m.';
