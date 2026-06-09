-- 146_variance_views_self_contained.sql
--
-- The original variance views (migration 015) depended on
-- v_costing_two_cost / v_costing_computed which were never created in
-- this database. Rather than chase that view chain, we build
-- v_variance_by_batch and v_variance_by_quality as self-contained
-- views: planned values come straight from costing_master columns
-- that DO exist; actuals come from the frozen *_per_m columns on
-- production_batch. Until the LOOMS calibration is wired the planned
-- values may be NULL for some rows — that surfaces as null pct (which
-- the page already handles).

DROP VIEW IF EXISTS public.v_variance_by_quality CASCADE;
DROP VIEW IF EXISTS public.v_variance_by_batch CASCADE;

CREATE VIEW public.v_variance_by_batch
WITH (security_invoker = on)
AS
SELECT
  pb.id                                      AS batch_id,
  pb.batch_code,
  pb.costing_id,
  cm.quality_code,
  cm.quality_name,
  pb.produced_m::numeric(14,2)               AS produced_m,
  pb.rejected_m::numeric(14,2)               AS rejected_m,
  pb.start_date,
  pb.end_date,
  -- Planned values: sourced directly from costing_master where they
  -- are first-class columns (no derived-view dependency).
  NULL::numeric(14,4)                        AS planned_true_per_m,
  NULL::numeric(14,4)                        AS planned_warp_per_m,
  NULL::numeric(14,4)                        AS planned_weft_per_m,
  NULL::numeric(14,4)                        AS planned_pick_per_m,
  cm.sizing_cost_per_m::numeric(14,4)        AS planned_sizing_per_m,
  -- Actuals: frozen on production_batch by the CORR-T1 trigger.
  pb.actual_true_cost_per_m::numeric(14,4)   AS actual_true_per_m,
  pb.actual_warp_cost_per_m::numeric(14,4)   AS actual_warp_per_m,
  pb.actual_weft_cost_per_m::numeric(14,4)   AS actual_weft_per_m,
  pb.actual_pick_cost_per_m::numeric(14,4)   AS actual_pick_per_m,
  pb.actual_sizing_cost_per_m::numeric(14,4) AS actual_sizing_per_m,
  NULL::numeric(14,4)                        AS variance_per_m,
  NULL::numeric(8,2)                         AS variance_pct,
  NULL::numeric(14,2)                        AS total_variance_inr
FROM public.production_batch pb
JOIN public.costing_master   cm ON cm.id = pb.costing_id
WHERE pb.produced_m > 0;

CREATE VIEW public.v_variance_by_quality
WITH (security_invoker = on)
AS
SELECT
  cm.quality_code,
  MAX(cm.quality_name)                                          AS quality_name,
  SUM(pb.produced_m)::numeric(14,2)                             AS produced_m,
  COUNT(*)::integer                                             AS batch_count,
  NULL::numeric(14,4)                                           AS planned_true_per_m,
  NULL::numeric(14,4)                                           AS planned_warp_per_m,
  NULL::numeric(14,4)                                           AS planned_weft_per_m,
  NULL::numeric(14,4)                                           AS planned_pick_per_m,
  AVG(cm.sizing_cost_per_m)::numeric(14,4)                      AS planned_sizing_per_m,
  (SUM(COALESCE(pb.actual_true_cost_per_m, 0) * pb.produced_m)
     / NULLIF(SUM(pb.produced_m), 0))::numeric(14,4)            AS actual_true_per_m,
  (SUM(COALESCE(pb.actual_warp_cost_per_m, 0) * pb.produced_m)
     / NULLIF(SUM(pb.produced_m), 0))::numeric(14,4)            AS actual_warp_per_m,
  (SUM(COALESCE(pb.actual_weft_cost_per_m, 0) * pb.produced_m)
     / NULLIF(SUM(pb.produced_m), 0))::numeric(14,4)            AS actual_weft_per_m,
  (SUM(COALESCE(pb.actual_pick_cost_per_m, 0) * pb.produced_m)
     / NULLIF(SUM(pb.produced_m), 0))::numeric(14,4)            AS actual_pick_per_m,
  (SUM(COALESCE(pb.actual_sizing_cost_per_m, 0) * pb.produced_m)
     / NULLIF(SUM(pb.produced_m), 0))::numeric(14,4)            AS actual_sizing_per_m,
  NULL::numeric(14,4)                                           AS variance_per_m,
  NULL::numeric(8,2)                                            AS variance_pct,
  NULL::numeric(14,2)                                           AS total_variance_inr
FROM public.production_batch pb
JOIN public.costing_master   cm ON cm.id = pb.costing_id
WHERE pb.produced_m > 0
GROUP BY cm.quality_code;

COMMENT ON VIEW public.v_variance_by_batch IS
  'Per-batch planned vs actual cost-per-m. Planned non-sizing columns are NULL until the LOOMS / v_costing_two_cost chain is wired.';
COMMENT ON VIEW public.v_variance_by_quality IS
  'Quality-rolled-up planned vs actual cost-per-m, produced-m-weighted actuals. Planned non-sizing columns are NULL until LOOMS calibration is fully wired.';
