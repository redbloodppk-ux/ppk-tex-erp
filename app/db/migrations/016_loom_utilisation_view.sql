-- 016_loom_utilisation_view.sql
-- Loom Utilisation (CORR-R8) - per-loom workload from production batches.
--
-- The original card asked for pick-rate / RPM / downtime per shift, but the
-- schema has no shift log, downtime capture, or RPM readings. This view uses
-- only what production_batch actually records: which loom ran a batch, how
-- many metres it produced and rejected, and the start/end dates.
--
-- One row per loom (every loom appears, even idle ones with no batches).
--
--   batch_count      - all batches ever assigned to the loom
--   finished_batches - batches with an end_date set
--   running_batches  - batches started but not yet ended
--   total_produced_m - good metres woven on the loom
--   total_rejected_m - rejected metres on the loom
--   rejection_pct    - rejected / (produced + rejected) * 100
--   active_days      - sum of (end_date - start_date + 1) over finished
--                      batches; an approximate count of loom-days worked
--   m_per_active_day - total_produced_m / active_days (throughput proxy)
--   last_batch_end   - most recent end_date (NULL = never finished a batch)

DROP VIEW IF EXISTS v_loom_utilisation CASCADE;

CREATE VIEW v_loom_utilisation
WITH (security_invoker = on)
AS
WITH batch_roll AS (
  SELECT
    pb.loom_id,
    COUNT(*)                                                   AS batch_count,
    COUNT(*) FILTER (WHERE pb.end_date IS NOT NULL)             AS finished_batches,
    COUNT(*) FILTER (WHERE pb.end_date IS NULL
                       AND pb.start_date IS NOT NULL)           AS running_batches,
    COALESCE(SUM(pb.produced_m), 0)                             AS total_produced_m,
    COALESCE(SUM(pb.rejected_m), 0)                             AS total_rejected_m,
    MIN(pb.start_date)                                          AS first_batch_start,
    MAX(pb.end_date)                                            AS last_batch_end,
    COALESCE(SUM(
      CASE
        WHEN pb.end_date IS NOT NULL AND pb.start_date IS NOT NULL
          THEN (pb.end_date - pb.start_date) + 1
        ELSE 0
      END
    ), 0)                                                       AS active_days
  FROM production_batch pb
  WHERE pb.loom_id IS NOT NULL
  GROUP BY pb.loom_id
)
SELECT
  l.id                                                          AS loom_id,
  l.loom_code,
  l.loom_type,
  l.width_in,
  l.status,
  COALESCE(br.batch_count, 0)::integer                          AS batch_count,
  COALESCE(br.finished_batches, 0)::integer                     AS finished_batches,
  COALESCE(br.running_batches, 0)::integer                      AS running_batches,
  COALESCE(br.total_produced_m, 0)::numeric(14,2)               AS total_produced_m,
  COALESCE(br.total_rejected_m, 0)::numeric(14,2)               AS total_rejected_m,
  CASE
    WHEN COALESCE(br.total_produced_m, 0) + COALESCE(br.total_rejected_m, 0) = 0
      THEN NULL
    ELSE (br.total_rejected_m
          / (br.total_produced_m + br.total_rejected_m) * 100)::numeric(8,2)
  END                                                           AS rejection_pct,
  COALESCE(br.active_days, 0)::integer                          AS active_days,
  CASE
    WHEN COALESCE(br.active_days, 0) = 0 THEN NULL
    ELSE (br.total_produced_m / br.active_days)::numeric(14,2)
  END                                                           AS m_per_active_day,
  CASE
    WHEN COALESCE(br.finished_batches, 0) = 0 THEN NULL
    ELSE (br.total_produced_m / br.finished_batches)::numeric(14,2)
  END                                                           AS avg_m_per_batch,
  br.first_batch_start,
  br.last_batch_end
FROM loom l
LEFT JOIN batch_roll br ON br.loom_id = l.id;

COMMENT ON VIEW v_loom_utilisation IS
  'Per-loom workload from production_batch: metres, rejection %, active days, throughput. No shift/RPM/downtime data exists yet.';
