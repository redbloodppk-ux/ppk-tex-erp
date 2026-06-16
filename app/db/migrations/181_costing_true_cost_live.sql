-- 181_costing_true_cost_live.sql
--
-- Real-time True ₹/m on Fabric Costing.
--
-- Replaces `v_costing_two_cost` (created by migration 177) so that
-- `true_cost_per_m` is recomputed LIVE from the latest yarn purchase
-- prices on `yarn_lot`, while `quoted_cost_per_m` stays as the frozen
-- value the calculator wrote at save time.
--
-- Method:
--   1) `yarn_now` CTE: per yarn_count, the most-recent yarn_lot
--      cost_per_kg (by received_date DESC then id DESC).
--   2) For each costing_master row, compute three deltas — one per
--      yarn component (warp / weft / porvai):
--           Δ = (live_cost_per_kg − snapshot_cost_per_kg) ÷ m_per_kg
--      Δ is the per-metre Rs change for that yarn. We only add the
--      delta because `quoted_cost_per_m` already carries the
--      snapshot-time yarn cost baked in — adding Δ shifts it to the
--      live cost without re-running the whole formula in SQL.
--   3) `true_cost_per_m = quoted_cost_per_m + Δwarp + Δweft + Δporvai`
--      Falls back to `quoted_cost_per_m` whenever a yarn count has no
--      bill yet (Δ = 0 in that branch).
--
-- Non-yarn cost parts (pick, sizing, bobbin, porvai loading, etc.)
-- stay from the snapshot. Add a separate refresh trigger later if you
-- want those to flow live too.

BEGIN;

DROP VIEW IF EXISTS public.v_costing_two_cost CASCADE;

CREATE VIEW public.v_costing_two_cost
WITH (security_invoker=on) AS
WITH yarn_now AS (
  SELECT DISTINCT ON (yarn_count_id)
    yarn_count_id,
    cost_per_kg,
    received_date,
    id AS yarn_lot_id
  FROM public.yarn_lot
  WHERE yarn_count_id IS NOT NULL
    AND cost_per_kg IS NOT NULL
    AND cost_per_kg > 0
  ORDER BY yarn_count_id, received_date DESC NULLS LAST, id DESC
),
calc AS (
  SELECT
    cm.id,
    cm.quality_code,
    cm.quality_name,
    cm.quoted_cost_per_m,
    cm.warp_m_per_kg,
    cm.weft_m_per_kg,
    cm.porvai_m_per_kg,
    cm.sizing_cost_per_m,
    cm.grams_per_m,
    cm.gsm,
    cm.calc_snapshot AS s,
    yw.cost_per_kg   AS live_warp_kg,
    ywf.cost_per_kg  AS live_weft_kg,
    yp.cost_per_kg   AS live_porvai_kg
  FROM public.costing_master cm
  LEFT JOIN yarn_now yw  ON yw.yarn_count_id  = cm.warp_count_id
  LEFT JOIN yarn_now ywf ON ywf.yarn_count_id = cm.weft_count_id
  LEFT JOIN yarn_now yp  ON yp.yarn_count_id  = cm.porvai_count_id
),
deltas AS (
  SELECT
    calc.id,
    calc.quality_code,
    calc.quality_name,
    calc.quoted_cost_per_m,
    calc.sizing_cost_per_m,
    calc.warp_m_per_kg,
    calc.weft_m_per_kg,
    calc.grams_per_m,
    calc.gsm,
    /* Warp Δ — only when we have BOTH a live price AND a snapshot
       rate AND a valid m/kg. Otherwise the term is 0 (true = quoted). */
    CASE
      WHEN calc.warp_m_per_kg > 0
        AND calc.live_warp_kg IS NOT NULL
        AND (calc.s->>'warpRate') IS NOT NULL
        AND (calc.s->>'warpRate')::numeric > 0
      THEN (calc.live_warp_kg - (calc.s->>'warpRate')::numeric) / calc.warp_m_per_kg
      ELSE 0
    END AS delta_warp,

    CASE
      WHEN calc.weft_m_per_kg > 0
        AND calc.live_weft_kg IS NOT NULL
        AND (calc.s->>'weftRate') IS NOT NULL
        AND (calc.s->>'weftRate')::numeric > 0
      THEN (calc.live_weft_kg - (calc.s->>'weftRate')::numeric) / calc.weft_m_per_kg
      ELSE 0
    END AS delta_weft,

    CASE
      WHEN COALESCE(calc.porvai_m_per_kg, 0) > 0
        AND calc.live_porvai_kg IS NOT NULL
        AND (calc.s->>'porvaiYarnCost') IS NOT NULL
        AND (calc.s->>'porvaiYarnCost')::numeric > 0
      THEN (calc.live_porvai_kg - (calc.s->>'porvaiYarnCost')::numeric) / calc.porvai_m_per_kg
      ELSE 0
    END AS delta_porvai,

    calc.live_warp_kg,
    calc.live_weft_kg,
    calc.live_porvai_kg
  FROM calc
)
SELECT
  id,
  quality_code,
  quality_name,
  quoted_cost_per_m,
  /* True ₹/m — quoted plus the yarn-price deltas (positive when prices
     rose, negative when they fell). NULLs in deltas already collapsed
     to 0 inside the CASE, so the result is always a real number when
     quoted is. */
  ROUND(
    COALESCE(quoted_cost_per_m, 0) + delta_warp + delta_weft + delta_porvai,
    2
  )::numeric(12,2)                                AS true_cost_per_m,
  /* Pass-throughs kept for any consumer (variance dashboard, etc.). */
  sizing_cost_per_m,
  warp_m_per_kg,
  weft_m_per_kg,
  grams_per_m,
  gsm,
  /* New diagnostic columns the list page (or any UI) can surface to
     explain a True-vs-Quoted gap. */
  live_warp_kg                                    AS live_warp_cost_per_kg,
  live_weft_kg                                    AS live_weft_cost_per_kg,
  live_porvai_kg                                  AS live_porvai_cost_per_kg,
  ROUND(delta_warp,   2)::numeric(12,2)           AS delta_warp_per_m,
  ROUND(delta_weft,   2)::numeric(12,2)           AS delta_weft_per_m,
  ROUND(delta_porvai, 2)::numeric(12,2)           AS delta_porvai_per_m
FROM deltas;

COMMENT ON VIEW public.v_costing_two_cost IS
  'Per-costing cost-per-metre. quoted_cost_per_m is the frozen value at save time. true_cost_per_m is recomputed LIVE from the latest yarn_lot purchase prices per yarn_count (warp/weft/porvai) — falls back to quoted when a yarn count has no bill yet.';

COMMIT;
