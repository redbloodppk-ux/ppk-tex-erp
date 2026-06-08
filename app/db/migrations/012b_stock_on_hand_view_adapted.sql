-- 012b_stock_on_hand_view_adapted.sql
--
-- Adapted re-issue of migration 012 (v_stock_on_hand). The original
-- migration referenced columns on v_yarn_days_of_cover that no longer
-- exist on this project — that upstream view was re-defined later with
-- a different shape, so 012 silently broke when it tried to apply on
-- a fresh DB.
--
-- Live shape of v_yarn_days_of_cover on this project:
--   yarn_count_code, on_hand_kg, avg_cost_per_kg, days_of_cover
-- Original 012 assumed:
--   yarn_count_id, kg_30d, days_of_cover
--
-- Changes vs 012:
--   • Join becomes  doc.yarn_count_code = yc.code  (not doc.yarn_count_id).
--   • kg_30d is returned as NULL because the live view no longer exposes
--     it. The /app/reports/stock-on-hand page already types that column
--     as `number | null`, so the cell renders as a dash with no UI change.
--
-- Symptom this fixes: the Stock on Hand report was throwing
-- "Failed to load v_stock_on_hand: Could not find the table
-- 'public.v_stock_on_hand' in the schema cache" because the original
-- view creation failed silently in this project's history.
--
-- Idempotent: DROP + CREATE.

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

  -- kg_30d isn't exposed by the current v_yarn_days_of_cover; return
  -- NULL so the page's nullable column renders as a dash. If we add
  -- a 30-day consumption rollup later we can plug it in here.
  NULL::numeric                                          AS kg_30d,
  doc.days_of_cover
FROM yarn_count yc
LEFT JOIN lot_agg la                ON la.yarn_count_id   = yc.id
LEFT JOIN v_yarn_days_of_cover doc  ON doc.yarn_count_code = yc.code;

COMMENT ON VIEW public.v_stock_on_hand IS
  'CORR-R2 Stock on hand. One row per yarn_count with weighted-avg cost, stock value, reorder flag, and days_of_cover. kg_30d returns NULL because the live v_yarn_days_of_cover does not expose it; the report page renders that column as a dash when null.';

COMMIT;
