-- 021_loom_shift_utilisation_view.sql
-- Loom Shift Utilisation (CORR-P4) - per-loom % uptime + metres-per-shift
-- roll-up, built on the production_shift_log table created in migration 020.
--
-- Each logged shift is a fixed 720-minute window (12 hours). A loom's uptime
-- for a shift is (720 - downtime_minutes); its runtime capacity is 720. Rolled
-- up across all logged shifts:
--
--   shift_count          - number of shift rows logged for the loom
--   total_metres         - good metres woven across all logged shifts
--   avg_metres_per_shift - total_metres / shift_count
--   total_downtime_min   - downtime minutes summed across logged shifts
--   capacity_min         - shift_count * 720 (theoretical runtime)
--   runtime_min          - capacity_min - total_downtime_min
--   uptime_pct           - runtime_min / capacity_min * 100
--   last_log_date        - most recent shift logged (NULL = never logged)
--
-- One row per loom; every loom appears, even those never logged.

DROP VIEW IF EXISTS v_loom_shift_utilisation CASCADE;

CREATE VIEW v_loom_shift_utilisation
WITH (security_invoker = on)
AS
WITH shift_roll AS (
  SELECT
    psl.loom_id,
    COUNT(*)                                  AS shift_count,
    COALESCE(SUM(psl.metres_woven), 0)        AS total_metres,
    COALESCE(SUM(psl.downtime_minutes), 0)    AS total_downtime_min,
    MAX(psl.log_date)                         AS last_log_date
  FROM production_shift_log psl
  GROUP BY psl.loom_id
)
SELECT
  l.id                                                          AS loom_id,
  l.loom_code,
  l.loom_type,
  l.status,
  COALESCE(sr.shift_count, 0)::integer                          AS shift_count,
  COALESCE(sr.total_metres, 0)::numeric(14,2)                   AS total_metres,
  CASE
    WHEN COALESCE(sr.shift_count, 0) = 0 THEN NULL
    ELSE (sr.total_metres / sr.shift_count)::numeric(14,2)
  END                                                           AS avg_metres_per_shift,
  COALESCE(sr.total_downtime_min, 0)::integer                   AS total_downtime_min,
  (COALESCE(sr.shift_count, 0) * 720)::integer                  AS capacity_min,
  (COALESCE(sr.shift_count, 0) * 720
     - COALESCE(sr.total_downtime_min, 0))::integer             AS runtime_min,
  CASE
    WHEN COALESCE(sr.shift_count, 0) = 0 THEN NULL
    ELSE (((sr.shift_count * 720) - sr.total_downtime_min)::numeric
          / (sr.shift_count * 720) * 100)::numeric(6,2)
  END                                                           AS uptime_pct,
  sr.last_log_date
FROM loom l
LEFT JOIN shift_roll sr ON sr.loom_id = l.id;

COMMENT ON VIEW v_loom_shift_utilisation IS
  'CORR-P4: per-loom uptime % and metres-per-shift rolled up from production_shift_log (720-min shifts).';
