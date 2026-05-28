-- ─────────────────────────────────────────────────────────────────────────
-- 042_shift_log_adjustment_metres.sql
--
-- Adds an `adjustment_metres` column to production_shift_log so a supervisor
-- can post a free-form +/- correction per loom-shift (e.g. cut a defective
-- length, balance an over-recorded reading, etc.).
--
-- The loom Total shown in the UI is:
--     SUM(production_shift_log_weaver.metres_woven) + adjustment_metres
--
-- v_loom_shift_utilisation is rebuilt so the rolled-up total_metres also
-- carries the adjustment. We compute per-shift totals in a CTE first, then
-- sum them by loom, so the adjustment isn't multiplied by the number of
-- weavers on each shift.
--
-- Idempotent: safe to re-run. Wrapped in a single transaction.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. New column on the parent table. No CHECK constraint - adjustment can
--    be positive (added metres) or negative (cut metres).
ALTER TABLE production_shift_log
  ADD COLUMN IF NOT EXISTS adjustment_metres numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN production_shift_log.adjustment_metres IS
  'Free-form +/- metres correction posted by a supervisor for this loom-shift. '
  'Loom net output for the shift = SUM(child weaver metres) + adjustment_metres.';

-- 2. Rebuild v_loom_shift_utilisation so total_metres includes adjustment.
DROP VIEW IF EXISTS v_loom_shift_utilisation CASCADE;

CREATE VIEW v_loom_shift_utilisation
WITH (security_invoker = on)
AS
WITH shift_total AS (
  SELECT
    psl.id,
    psl.loom_id,
    psl.log_date,
    COALESCE(
      (SELECT SUM(pslw.metres_woven)
         FROM production_shift_log_weaver pslw
        WHERE pslw.shift_log_id = psl.id),
      0
    ) + psl.adjustment_metres AS net_metres
  FROM production_shift_log psl
),
shift_roll AS (
  SELECT
    st.loom_id,
    COUNT(*)                              AS shift_count,
    COALESCE(SUM(st.net_metres), 0)       AS total_metres,
    MAX(st.log_date)                      AS last_log_date
  FROM shift_total st
  GROUP BY st.loom_id
)
SELECT
  l.id                                                AS loom_id,
  l.loom_code,
  l.loom_type,
  l.status,
  COALESCE(sr.shift_count, 0)::integer                AS shift_count,
  COALESCE(sr.total_metres, 0)::numeric(14,2)         AS total_metres,
  CASE
    WHEN COALESCE(sr.shift_count, 0) = 0 THEN NULL
    ELSE (sr.total_metres / sr.shift_count)::numeric(14,2)
  END                                                 AS avg_metres_per_shift,
  sr.last_log_date
FROM loom l
LEFT JOIN shift_roll sr ON sr.loom_id = l.id;

COMMENT ON VIEW v_loom_shift_utilisation IS
  'Per-loom shift counts and net metres (weaver metres + adjustment) rolled '
  'up from production_shift_log + production_shift_log_weaver. Updated in 042.';

COMMIT;
