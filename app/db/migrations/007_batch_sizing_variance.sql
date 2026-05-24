-- ────────────────────────────────────────────────────────────────────────────
-- Migration 007 — Batch ↔ pavu_assign link + actual sizing variance (CORR-T4)
--
--   T-B3 / CORR-T4. After T-B7 (005) and T-B7+sizing (006), every batch row
--   knows what the COSTING said sizing should cost (₹/m). It still doesn't
--   know what sizing ACTUALLY cost — that lives on sizing_job.sizing_rate_per_kg
--   and is paid per kg of warp yarn, not per metre of cloth.
--
--   Schema gap: production_batch had no FK back to the sizing_job that
--   produced its warp. The chain is:
--     sizing_job ──< pavu ──< pavu_assign ──> loom
--   We add `pavu_assign_id` on production_batch (nullable, so legacy rows
--   stay untouched) and snapshot the per-kg rate at INSERT time. The
--   variance view does the arithmetic; the column gives us a frozen rate
--   even if a vendor renegotiates the sizing job after the batch closes.
--
--   Why per-kg rate is meaningful:
--     sizing is billed on yarn_used_kg × sizing_rate_per_kg.
--     a sizing_job produces N pavus, each with `meters`.
--     actual_sizing_cost_per_m = (rate × yarn_used_kg) / Σ pavu.meters
--   That's what v_batch_sizing_variance reports. Delta vs the planned
--   snapshot drives CORR-R3 (sizing spend) and CORR-R5 (margin).
--
-- Safe to re-run: every ALTER / CREATE OR REPLACE / DROP TRIGGER IF EXISTS
-- is idempotent.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Link production_batch → pavu_assign ───────────────────────────────
ALTER TABLE production_batch
  ADD COLUMN IF NOT EXISTS pavu_assign_id          bigint
    REFERENCES pavu_assign(id);

ALTER TABLE production_batch
  ADD COLUMN IF NOT EXISTS actual_sizing_rate_per_kg numeric(10,4);

CREATE INDEX IF NOT EXISTS idx_batch_pavu_assign
  ON production_batch(pavu_assign_id);

COMMENT ON COLUMN production_batch.pavu_assign_id IS
  'Optional FK to the pavu_assign row that put the warp beam on the loom. '
  'Lets us trace this batch back to its sizing_job for actual ₹/kg variance. '
  'Nullable: legacy batches and outsourced flows leave it NULL. CORR-T4.';

COMMENT ON COLUMN production_batch.actual_sizing_rate_per_kg IS
  'Sizing ₹/kg frozen at batch insert from sizing_job.sizing_rate_per_kg via '
  'pavu_assign → pavu → sizing_job. Compare against actual_sizing_cost_per_m '
  '(planned per-metre) using v_batch_sizing_variance. CORR-T4.';

-- ─── 2. Republish snapshot function to also fill the per-kg rate ──────────
CREATE OR REPLACE FUNCTION fn_snapshot_batch_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cost          RECORD;
  v_sizing_rate   numeric(10,4);
BEGIN
  -- (a) Two-cost snapshot — same as 006.
  SELECT
    production_mode,
    quoted_cost_per_m,
    true_cost_per_m,
    warp_cost_per_m,
    weft_cost_per_m,
    bobbin_1_cost_per_m,
    bobbin_2_cost_per_m,
    porvai_cost_per_m,
    sizing_cost_per_m,
    pick_or_overhead_true_per_m
  INTO v_cost
  FROM v_costing_two_cost
  WHERE id = NEW.costing_id;

  IF NOT FOUND THEN
    -- Don't block batch creation if the view can't resolve.
    RETURN NEW;
  END IF;

  IF NEW.actual_warp_cost_per_m   IS NULL THEN NEW.actual_warp_cost_per_m   := v_cost.warp_cost_per_m;   END IF;
  IF NEW.actual_weft_cost_per_m   IS NULL THEN NEW.actual_weft_cost_per_m   := v_cost.weft_cost_per_m;   END IF;
  IF NEW.actual_porvai_cost_per_m IS NULL THEN NEW.actual_porvai_cost_per_m := v_cost.porvai_cost_per_m; END IF;
  IF NEW.actual_sizing_cost_per_m IS NULL THEN NEW.actual_sizing_cost_per_m := v_cost.sizing_cost_per_m; END IF;

  IF NEW.actual_overhead_per_m IS NULL THEN
    NEW.actual_overhead_per_m := CASE
      WHEN v_cost.production_mode = 'inhouse' THEN v_cost.pick_or_overhead_true_per_m
      ELSE 0
    END;
  END IF;
  IF NEW.actual_pick_cost_per_m IS NULL THEN
    NEW.actual_pick_cost_per_m := CASE
      WHEN v_cost.production_mode = 'inhouse' THEN 0
      ELSE v_cost.pick_or_overhead_true_per_m
    END;
  END IF;

  IF NEW.actual_bobbin_cost_per_m IS NULL THEN
    NEW.actual_bobbin_cost_per_m := COALESCE(v_cost.bobbin_1_cost_per_m, 0)
                                  + COALESCE(v_cost.bobbin_2_cost_per_m, 0);
  END IF;
  IF NEW.actual_true_cost_per_m   IS NULL THEN NEW.actual_true_cost_per_m   := v_cost.true_cost_per_m;   END IF;

  -- (b) NEW in 007: snapshot the actual sizing ₹/kg from the sizing_job
  --     that produced this beam. Only when caller didn't pre-set it.
  IF NEW.actual_sizing_rate_per_kg IS NULL AND NEW.pavu_assign_id IS NOT NULL THEN
    SELECT s.sizing_rate_per_kg
      INTO v_sizing_rate
      FROM pavu_assign pa
      JOIN pavu        p ON p.id = pa.pavu_id
      JOIN sizing_job  s ON s.id = p.sizing_job_id
     WHERE pa.id = NEW.pavu_assign_id;

    IF FOUND THEN
      NEW.actual_sizing_rate_per_kg := v_sizing_rate;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_snapshot_batch_cost() FROM PUBLIC, anon, authenticated;

-- Trigger already exists from migration 005; signature unchanged.

-- ─── 3. v_batch_sizing_variance — planned vs actual sizing ₹/m ────────────
--
--   Methodology:
--     For each batch that has a pavu_assign_id, walk back to the sizing_job
--     and total up *every* metre that job produced (Σ pavu.meters). Sizing
--     was billed per kg of yarn used; divide that total billing by total
--     metres to get a true blended actual ₹/m. Compare to the planned
--     snapshot. Multiply delta by batch.produced_m for ₹ impact.
--
--   Batches without pavu_assign_id (legacy / outsourced) come through with
--   NULL actual columns — UI should render them as "N/A".
--
DROP VIEW IF EXISTS v_batch_sizing_variance CASCADE;
CREATE VIEW v_batch_sizing_variance AS
WITH job_meters AS (
  -- Total metres produced by each sizing_job (sum across all its pavus).
  SELECT
    p.sizing_job_id,
    SUM(p.meters)::numeric(14,2) AS total_meters
  FROM pavu p
  GROUP BY p.sizing_job_id
),
job_actual AS (
  -- Per-metre actual sizing cost for each sizing_job.
  SELECT
    s.id                       AS sizing_job_id,
    s.job_code,
    s.sizing_rate_per_kg,
    s.yarn_used_kg,
    jm.total_meters,
    CASE
      WHEN jm.total_meters > 0
      THEN (s.sizing_rate_per_kg * s.yarn_used_kg) / jm.total_meters
      ELSE NULL
    END::numeric(10,4)         AS actual_sizing_cost_per_m
  FROM sizing_job s
  LEFT JOIN job_meters jm ON jm.sizing_job_id = s.id
)
SELECT
  pb.id                                    AS batch_id,
  pb.batch_code,
  pb.costing_id,
  pb.pavu_assign_id,
  pa.pavu_id,
  pv.sizing_job_id,
  ja.job_code                              AS sizing_job_code,
  pb.produced_m,

  -- Planned (from costing, snapshotted at batch insert)
  pb.actual_sizing_cost_per_m              AS planned_sizing_cost_per_m,

  -- Actual (from the sizing_job)
  pb.actual_sizing_rate_per_kg             AS snapshot_sizing_rate_per_kg,
  ja.sizing_rate_per_kg                    AS live_sizing_rate_per_kg,
  ja.yarn_used_kg                          AS sizing_job_yarn_used_kg,
  ja.total_meters                          AS sizing_job_total_meters,
  ja.actual_sizing_cost_per_m              AS actual_sizing_cost_per_m,

  -- Variance: positive = overrun, negative = saving
  (ja.actual_sizing_cost_per_m - pb.actual_sizing_cost_per_m)::numeric(10,4)
                                           AS variance_per_m,
  ((ja.actual_sizing_cost_per_m - pb.actual_sizing_cost_per_m) * pb.produced_m)::numeric(14,2)
                                           AS variance_total
FROM production_batch pb
LEFT JOIN pavu_assign pa ON pa.id = pb.pavu_assign_id
LEFT JOIN pavu         pv ON pv.id = pa.pavu_id
LEFT JOIN job_actual   ja ON ja.sizing_job_id = pv.sizing_job_id;

COMMENT ON VIEW v_batch_sizing_variance IS
  'Planned vs actual sizing ₹/m per production batch. Planned comes from the '
  'costing snapshot on production_batch (CORR-T3); actual is derived from the '
  'sizing_job (rate × yarn_used_kg ÷ Σ pavu.meters). Batches without a '
  'pavu_assign_id surface NULL actuals. Drives CORR-R3 / R5. CORR-T4.';

-- Same read access as the underlying tables.
GRANT SELECT ON v_batch_sizing_variance TO anon, authenticated;

COMMIT;
