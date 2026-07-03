-- ============================================================================
-- 228: Decouple the metres-count window start from the mounted date.
--
-- Mounted date (pavu_assign.start_date) is when the beam was physically put
-- on the loom. But Shift Production Log entries are sometimes entered late,
-- and production typically only really gets going the day AFTER mounting —
-- so crediting metres to the assignment starting on the mount date itself
-- can be wrong. This adds a separate, independently-editable
-- metres_start_date that the app defaults to (mounted date + 1 day) but the
-- user can override.
--
-- fn_recompute_pavu_assign_metres now sums shift-log entries from
-- COALESCE(metres_start_date, start_date) instead of start_date. Falling
-- back to start_date keeps old assignments (created before this migration)
-- working exactly as before until someone edits them.
-- ============================================================================
ALTER TABLE pavu_assign ADD COLUMN IF NOT EXISTS metres_start_date date;

COMMENT ON COLUMN pavu_assign.metres_start_date IS
  'Date from which Shift Production Log entries count toward this assignment''s metres_produced. Defaults in the app to start_date (mounted date) + 1 day, but is independently editable — shift logs are sometimes entered late, so this should not always be assumed equal to the mounted date.';

-- One-off backfill: give existing assignments a sensible default so the
-- next recompute doesn't suddenly zero out metres_produced for anything
-- that was scoped from its mounted date.
UPDATE pavu_assign
SET metres_start_date = start_date + INTERVAL '1 day'
WHERE start_date IS NOT NULL AND metres_start_date IS NULL;

CREATE OR REPLACE FUNCTION fn_recompute_pavu_assign_metres(p_loom_id bigint)
RETURNS void AS $$
DECLARE
  r RECORD;
  v_weaver_sum numeric(12,2);
  v_adj_sum    numeric(12,2);
  v_window_start date;
BEGIN
  FOR r IN SELECT id, start_date, metres_start_date, end_date FROM pavu_assign WHERE loom_id = p_loom_id LOOP
    IF r.start_date IS NULL THEN
      UPDATE pavu_assign SET metres_produced = 0 WHERE id = r.id;
      CONTINUE;
    END IF;

    v_window_start := COALESCE(r.metres_start_date, r.start_date);

    SELECT COALESCE(SUM(w.metres_woven), 0) INTO v_weaver_sum
    FROM production_shift_log_weaver w
    JOIN production_shift_log s ON s.id = w.shift_log_id
    WHERE s.loom_id = p_loom_id
      AND s.log_date >= v_window_start
      AND s.log_date <= COALESCE(r.end_date, CURRENT_DATE);

    SELECT COALESCE(SUM(s.adjustment_metres), 0) INTO v_adj_sum
    FROM production_shift_log s
    WHERE s.loom_id = p_loom_id
      AND s.log_date >= v_window_start
      AND s.log_date <= COALESCE(r.end_date, CURRENT_DATE);

    UPDATE pavu_assign
    SET metres_produced = v_weaver_sum + v_adj_sum
    WHERE id = r.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Recompute everything now that the window start may have shifted by a day.
DO $$
DECLARE
  lm RECORD;
BEGIN
  FOR lm IN SELECT DISTINCT loom_id FROM pavu_assign LOOP
    PERFORM fn_recompute_pavu_assign_metres(lm.loom_id);
  END LOOP;
END $$;
