-- ────────────────────────────────────────────────────────────────────────────
-- Migration 006 — Sizing cost in ProductionBatch True Cost snapshot (CORR-T3)
--
--   T-B7 (migration 005) snapshotted warp / weft / porvai / pick / overhead /
--   bobbin breakdowns plus the rolled-up True Cost. Sizing cost was missing
--   from the breakdown — it was getting included inside `actual_true_cost_per_m`
--   (because v_costing_two_cost.true_cost_per_m already sums it in) but there
--   was no per-batch sizing column, so component-level reconciliation didn't
--   tie out.
--
--   This migration:
--     1. Adds production_batch.actual_sizing_cost_per_m numeric(10,4).
--     2. Updates fn_snapshot_batch_cost() to populate it from
--        v_costing_two_cost.sizing_cost_per_m on INSERT, same "only fill when
--        caller left NULL" pattern as the other breakdown columns.
--
--   Read alongside docs/CORRECTION_GUIDE_v1.1.md → D10 (sizing pricing lives
--   on sizing_job, not vendor master) — that decision is what unblocks this
--   card. CORR-R3 (sizing-spend report) and CORR-R5 (margin) will later use
--   the same column to compute planned-vs-actual sizing variance.
--
-- Safe to re-run: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE FUNCTION.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. Add the breakdown column to production_batch ─────────────────────
ALTER TABLE production_batch
  ADD COLUMN IF NOT EXISTS actual_sizing_cost_per_m numeric(10,4);

COMMENT ON COLUMN production_batch.actual_sizing_cost_per_m IS
  'Sizing ₹/m frozen at batch insert from costing_master.sizing_cost_per_m. '
  'Already included inside actual_true_cost_per_m — this column makes the '
  'breakdown reconcilable. CORR-T3.';

-- ─── 2. Republish snapshot function to also fill the sizing column ────────
CREATE OR REPLACE FUNCTION fn_snapshot_batch_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cost RECORD;
BEGIN
  -- Pull the live two-cost row for the chosen costing_master. v_costing_two_cost
  -- already collapses LOOMS overhead (inhouse) and vendor pick (outsourced) into
  -- pick_or_overhead_true_per_m, and rolls up sizing/auto/commissions into
  -- true_cost_per_m. We snapshot the named components so per-batch breakdowns
  -- stay stable even if the live costing drifts after batch close.
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
    -- Don't block batch creation if the view can't resolve — let the row in
    -- with NULL snapshot columns. The Production module can backfill later.
    RETURN NEW;
  END IF;

  -- Only fill columns that the caller hasn't explicitly set. This keeps any
  -- floor-side corrections entered at Fabric Receipt intact while still
  -- snapshotting whatever the spec gave us.
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

  RETURN NEW;
END;
$$;

-- Same grant pattern as migration 005 — definer rights, no public execute.
REVOKE EXECUTE ON FUNCTION fn_snapshot_batch_cost() FROM PUBLIC, anon, authenticated;

-- Trigger created in 005 — no DROP/CREATE needed because we only replaced the
-- function body and the signature is unchanged.

COMMIT;
