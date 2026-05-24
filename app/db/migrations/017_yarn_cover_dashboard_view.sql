-- ─────────────────────────────────────────────────────────────────────────
-- 017_yarn_cover_dashboard_view.sql      (CORR-R9)
--
-- v_yarn_cover_dashboard
--   One row per yarn_count. Wraps the existing v_yarn_days_of_cover view
--   (available_kg, kg_30d, days_of_cover) and enriches it with master
--   fields needed for an at-a-glance "will we run out?" dashboard:
--
--     • yarn_type, reorder_kg, status   — from yarn_count master
--     • below_reorder                   — available_kg < reorder_kg
--     • cover_status                    — risk bucket the page colours by:
--         'out'      available_kg = 0 (nothing in stock)
--         'critical' days_of_cover < 7
--         'low'      days_of_cover < 21
--         'ok'       days_of_cover >= 21
--         'idle'     days_of_cover is NULL — no warp consumption in the
--                    last 30 days, so cover cannot be computed yet
--
--   days_of_cover comes straight from v_yarn_days_of_cover, which divides
--   available_kg by average daily warp consumption over the trailing 30
--   days. When there has been no recent production, consumption is 0 and
--   cover is NULL (bucketed as 'idle').
--
-- Idempotent: DROP + CREATE inside a single transaction.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DROP VIEW IF EXISTS public.v_yarn_cover_dashboard CASCADE;

CREATE VIEW public.v_yarn_cover_dashboard
WITH (security_invoker = on) AS
SELECT
  yc.id                                                   AS yarn_count_id,
  yc.code,
  yc.display_name,
  yc.yarn_type,
  yc.reorder_kg,
  yc.status,

  COALESCE(doc.available_kg, 0)::numeric(14,2)            AS available_kg,
  COALESCE(doc.kg_30d, 0)::numeric(14,2)                  AS kg_30d,
  doc.days_of_cover,

  CASE
    WHEN yc.reorder_kg IS NOT NULL
     AND yc.reorder_kg > 0
     AND COALESCE(doc.available_kg, 0) < yc.reorder_kg
    THEN true
    ELSE false
  END                                                     AS below_reorder,

  CASE
    WHEN COALESCE(doc.available_kg, 0) = 0          THEN 'out'
    WHEN doc.days_of_cover IS NULL                  THEN 'idle'
    WHEN doc.days_of_cover < 7                      THEN 'critical'
    WHEN doc.days_of_cover < 21                     THEN 'low'
    ELSE 'ok'
  END                                                     AS cover_status

FROM yarn_count yc
LEFT JOIN v_yarn_days_of_cover doc ON doc.yarn_count_id = yc.id;

COMMENT ON VIEW public.v_yarn_cover_dashboard IS
  'CORR-R9 Yarn days-of-cover dashboard. One row per yarn_count: available kg, 30-day warp consumption, days of cover, reorder flag and a cover_status risk bucket.';

COMMIT;
