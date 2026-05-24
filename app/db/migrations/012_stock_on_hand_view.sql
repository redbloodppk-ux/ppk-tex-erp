-- ─────────────────────────────────────────────────────────────────────────
-- 012_stock_on_hand_view.sql      (CORR-R2)
--
-- v_stock_on_hand
--   One row per yarn_count (master row). Aggregates every yarn_lot with
--   current_kg > 0 to give the owner an at-a-glance stock register:
--
--     • available_kg          — sum of remaining kg across all open lots
--     • weighted_avg_cost     — Σ(current_kg × cost_per_kg) ÷ Σ current_kg
--     • stock_value           — money value at weighted-avg cost (₹)
--     • lots_count            — number of open lots
--     • oldest / newest lot   — to spot aging stock
--     • below_reorder         — true when available_kg < reorder_kg
--     • kg_30d, days_of_cover — pulled from existing v_yarn_days_of_cover
--
--   Counts with NO open lots still appear (LEFT JOIN) so reorder warnings
--   surface for items that have run out. Page can filter them client-side.
--
-- Idempotent: DROP + CREATE inside a single transaction.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DROP VIEW IF EXISTS public.v_stock_on_hand CASCADE;

CREATE VIEW public.v_stock_on_hand
WITH (security_invoker=on) AS
WITH lot_agg AS (
  SELECT
    yarn_count_id,
    SUM(current_kg)                                      AS available_kg,
    SUM(current_kg * cost_per_kg)                        AS stock_value_raw,
    COUNT(*)                                             AS lots_count,
    MIN(received_date)                                   AS oldest_lot_date,
    MAX(received_date)                                   AS newest_lot_date
  FROM yarn_lot
  WHERE current_kg > 0
  GROUP BY yarn_count_id
)
SELECT
  yc.id                                                  AS yarn_count_id,
  yc.code,
  yc.display_name,
  yc.yarn_type,
  yc.ne,
  yc.denier,
  yc.is_doubled,
  yc.is_slub,
  yc.reorder_kg,
  yc.status,

  COALESCE(la.available_kg, 0)::numeric(14,2)            AS available_kg,
  CASE
    WHEN COALESCE(la.available_kg, 0) > 0
    THEN (la.stock_value_raw / la.available_kg)::numeric(14,4)
    ELSE NULL
  END                                                    AS weighted_avg_cost,
  COALESCE(la.stock_value_raw, 0)::numeric(14,2)         AS stock_value,
  COALESCE(la.lots_count, 0)::integer                    AS lots_count,
  la.oldest_lot_date,
  la.newest_lot_date,

  CASE
    WHEN yc.reorder_kg IS NOT NULL
     AND yc.reorder_kg > 0
     AND COALESCE(la.available_kg, 0) < yc.reorder_kg
    THEN true
    ELSE false
  END                                                    AS below_reorder,

  doc.kg_30d,
  doc.days_of_cover
FROM yarn_count yc
LEFT JOIN lot_agg la                ON la.yarn_count_id  = yc.id
LEFT JOIN v_yarn_days_of_cover doc  ON doc.yarn_count_id = yc.id;

COMMENT ON VIEW public.v_stock_on_hand IS
  'CORR-R2 Stock on hand. One row per yarn_count with weighted-avg cost, stock value, reorder flag, and days_of_cover.';

COMMIT;
