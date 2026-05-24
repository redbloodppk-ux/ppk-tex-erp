-- ────────────────────────────────────────────────────────────────────────────
-- Migration 005 — Costing approval notifications + ProductionBatch True Cost
--                  snapshot
--
--   CORR Group 2 covers two trigger-based behaviours that the schema doesn't
--   express on its own:
--
--   T-B11 (Costing approval workflow):
--     When a costing_master row lands or returns to approval_status='pending',
--     every owner should be notified. When a pending row is later approved or
--     rejected, the original submitter gets a notification telling them which
--     way it went.
--
--   T-B7 (ProductionBatch.batchCost snapshot):
--     The True Cost of any in-house batch must be frozen on the
--     production_batch row at INSERT time (Fabric Receipt). Stock valuation
--     (WMA) and P&L MUST use the snapshot — never the live costing_master,
--     which can drift once EB rates / wages / vendor picks move. We pull
--     the figures from v_costing_two_cost (which already mixes in
--     v_looms_overhead for inhouse, vendor_pick_paise for outsourced).
--
-- Safe to re-run: every CREATE OR REPLACE / DROP TRIGGER IF EXISTS is
-- idempotent.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── 1. T-B11: notify owners on pending, submitter on decision ────────────

CREATE OR REPLACE FUNCTION fn_notify_costing_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner          RECORD;
  v_submitter_name text;
BEGIN
  -- (a) INSERT → status is implicitly 'pending' on the form path.
  --     UPDATE  → only fire when approval_status actually transitions.
  IF (TG_OP = 'INSERT' AND NEW.approval_status = 'pending')
     OR (TG_OP = 'UPDATE' AND NEW.approval_status = 'pending'
         AND COALESCE(OLD.approval_status, 'pending') <> 'pending') THEN
    FOR v_owner IN
      SELECT id FROM app_user WHERE role = 'owner' AND is_active = true
    LOOP
      INSERT INTO notification (user_id, title, body, link, category)
      VALUES (
        v_owner.id,
        'New costing pending approval',
        format('Quality %s (%s) needs your sign-off before Sales can quote it.',
               NEW.quality_code, NEW.quality_name),
        '/app/costing/approvals',
        'approval'
      );
    END LOOP;

  -- (b) approved / rejected → notify the submitter, not the approver.
  ELSIF TG_OP = 'UPDATE'
        AND NEW.approval_status IN ('approved', 'rejected')
        AND OLD.approval_status = 'pending'
        AND NEW.created_by IS NOT NULL
        AND NEW.created_by <> COALESCE(NEW.approved_by, '00000000-0000-0000-0000-000000000000'::uuid)
  THEN
    INSERT INTO notification (user_id, title, body, link, category)
    VALUES (
      NEW.created_by,
      CASE WHEN NEW.approval_status = 'approved'
           THEN 'Costing approved'
           ELSE 'Costing rejected' END,
      format('Quality %s (%s) was %s by the owner.',
             NEW.quality_code, NEW.quality_name, NEW.approval_status),
      '/app/costing',
      'approval'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- The notification INSERT must run as definer because RLS on `notification`
-- restricts INSERT to user_id = auth.uid(); we're writing on behalf of others.
REVOKE EXECUTE ON FUNCTION fn_notify_costing_approval() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_costing_approval_notify ON costing_master;
CREATE TRIGGER trg_costing_approval_notify
  AFTER INSERT OR UPDATE OF approval_status ON costing_master
  FOR EACH ROW
  EXECUTE FUNCTION fn_notify_costing_approval();


-- ─── 2. T-B7: snapshot True Cost columns onto production_batch on INSERT ──

CREATE OR REPLACE FUNCTION fn_snapshot_batch_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cost RECORD;
BEGIN
  -- Pull the live two-cost row for the chosen costing_master.
  -- v_costing_two_cost already collapses LOOMS overhead (inhouse) and
  -- vendor pick (outsourced) into a single column: pick_or_overhead_true_per_m.
  -- We split it back out into the right production_batch column based on
  -- production_mode so stock valuation can see the two cost types separately.
  SELECT
    production_mode,
    quoted_cost_per_m,
    true_cost_per_m,
    warp_cost_per_m,
    weft_cost_per_m,
    bobbin_1_cost_per_m,
    bobbin_2_cost_per_m,
    porvai_cost_per_m,
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

REVOKE EXECUTE ON FUNCTION fn_snapshot_batch_cost() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_batch_cost_snapshot ON production_batch;
CREATE TRIGGER trg_batch_cost_snapshot
  BEFORE INSERT ON production_batch
  FOR EACH ROW
  EXECUTE FUNCTION fn_snapshot_batch_cost();

COMMIT;
