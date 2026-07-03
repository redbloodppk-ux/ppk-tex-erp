-- ============================================================================
-- 227: Keep pavu_assign.metres_produced in sync with actual Shift Production
-- Log entries, so the "m made" figure on the Pavu Assignment card is real
-- instead of always sitting at 0.
--
-- fn_recompute_pavu_assign_metres(p_loom_id) recomputes metres_produced for
-- every pavu_assign row on that loom, each scoped to its own
-- start_date .. COALESCE(end_date, CURRENT_DATE) window (so swapping beams
-- on a loom never credits metres to the wrong assignment). Total per window
-- = SUM(production_shift_log_weaver.metres_woven) + SUM(adjustment_metres),
-- matching the "Loom Total = sum(weavers) + adjustment" rule used on the
-- Shift Production Log page itself.
--
-- The app calls this RPC (best-effort, like the yarn-lot balance sync in
-- job-edit-form.tsx) after: saving the Shift Log, assigning/replacing a
-- pavu, editing an assignment's mounted date, and removing an assignment.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_recompute_pavu_assign_metres(p_loom_id bigint)
RETURNS void AS $$
DECLARE
  r RECORD;
  v_weaver_sum numeric(12,2);
  v_adj_sum    numeric(12,2);
BEGIN
  FOR r IN SELECT id, start_date, end_date FROM pavu_assign WHERE loom_id = p_loom_id LOOP
    IF r.start_date IS NULL THEN
      UPDATE pavu_assign SET metres_produced = 0 WHERE id = r.id;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(w.metres_woven), 0) INTO v_weaver_sum
    FROM production_shift_log_weaver w
    JOIN production_shift_log s ON s.id = w.shift_log_id
    WHERE s.loom_id = p_loom_id
      AND s.log_date >= r.start_date
      AND s.log_date <= COALESCE(r.end_date, CURRENT_DATE);

    SELECT COALESCE(SUM(s.adjustment_metres), 0) INTO v_adj_sum
    FROM production_shift_log s
    WHERE s.loom_id = p_loom_id
      AND s.log_date >= r.start_date
      AND s.log_date <= COALESCE(r.end_date, CURRENT_DATE);

    UPDATE pavu_assign
    SET metres_produced = v_weaver_sum + v_adj_sum
    WHERE id = r.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION fn_recompute_pavu_assign_metres(bigint) TO authenticated;

-- One-off backfill so existing assignments reflect history already logged.
DO $$
DECLARE
  lm RECORD;
BEGIN
  FOR lm IN SELECT DISTINCT loom_id FROM pavu_assign LOOP
    PERFORM fn_recompute_pavu_assign_metres(lm.loom_id);
  END LOOP;
END $$;
