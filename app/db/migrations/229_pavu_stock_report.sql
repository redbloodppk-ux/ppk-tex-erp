-- ============================================================================
-- 229: Beam Stock Report — per-beam status/metres reconstructed as of any date.
--
-- fn_pavu_stock_report(p_as_of) returns one row per pavu (beam) showing what
-- its status, loaded metre, and finished metre looked like as of that date:
--
--   - If an assignment (status mounted/running) covers p_as_of, the beam was
--     on_loom; finished_metre is computed live for that assignment's window,
--     capped at p_as_of (not "today"), same formula as
--     fn_recompute_pavu_assign_metres.
--   - Else, if the beam's most recent assignment had already ended by
--     p_as_of: status is 'finished' if that assignment was completed,
--     'in_stock' if it was removed (matches migration 226's restock rule).
--     finished_metre is that assignment's frozen total, mounted/finished
--     dates come from that assignment.
--   - Else the beam was never assigned as of p_as_of (or didn't exist yet,
--     in which case it's excluded).
--
-- Known limitation (accepted trade-off): pavu.status changes to 'damaged' or
-- 'scrapped' aren't date-stamped anywhere, so for those beams this always
-- reports the CURRENT status regardless of p_as_of. Everything else
-- (on_loom / in_stock / finished) is reconstructed from actual dated
-- records.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_pavu_stock_report(p_as_of date)
RETURNS TABLE (
  pavu_id        bigint,
  pavu_code      text,
  beam_no        text,
  ends           integer,
  yarn_count     text,
  set_no         text,
  loaded_metre   numeric,
  finished_metre numeric,
  status_as_of   text,
  mounted_date   date,
  finished_date  date
) AS $$
DECLARE
  p RECORD;
  a RECORD;
  v_weaver_sum numeric(12,2);
  v_adj_sum    numeric(12,2);
BEGIN
  FOR p IN
    SELECT pv.id, pv.pavu_code, pv.beam_no, pv.ends, pv.meters, pv.status, pv.created_at,
           wc.code AS yarn_count, sj.set_no
    FROM pavu pv
    LEFT JOIN sizing_job sj ON sj.id = pv.sizing_job_id
    LEFT JOIN yarn_count wc ON wc.id = sj.warp_count_id
  LOOP
    -- Beam didn't exist yet as of the requested date — leave it out.
    IF p.created_at::date > p_as_of THEN
      CONTINUE;
    END IF;

    -- Case 1: an assignment actively covers p_as_of → on the loom.
    SELECT * INTO a
    FROM pavu_assign
    WHERE pavu_assign.pavu_id = p.id
      AND pavu_assign.status IN ('mounted', 'running')
      AND pavu_assign.start_date IS NOT NULL
      AND pavu_assign.start_date <= p_as_of
      AND (pavu_assign.end_date IS NULL OR pavu_assign.end_date >= p_as_of)
    ORDER BY pavu_assign.start_date DESC
    LIMIT 1;

    IF FOUND THEN
      SELECT COALESCE(SUM(w.metres_woven), 0) INTO v_weaver_sum
      FROM production_shift_log_weaver w
      JOIN production_shift_log s ON s.id = w.shift_log_id
      WHERE s.loom_id = a.loom_id
        AND s.log_date >= COALESCE(a.metres_start_date, a.start_date)
        AND s.log_date <= p_as_of;

      SELECT COALESCE(SUM(s.adjustment_metres), 0) INTO v_adj_sum
      FROM production_shift_log s
      WHERE s.loom_id = a.loom_id
        AND s.log_date >= COALESCE(a.metres_start_date, a.start_date)
        AND s.log_date <= p_as_of;

      pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
      yarn_count := p.yarn_count; set_no := p.set_no;
      loaded_metre := p.meters;
      finished_metre := v_weaver_sum + v_adj_sum;
      status_as_of := 'on_loom';
      mounted_date := a.start_date;
      finished_date := NULL;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Case 2: most recent assignment that had already ended by p_as_of.
    SELECT * INTO a
    FROM pavu_assign
    WHERE pavu_assign.pavu_id = p.id
      AND pavu_assign.end_date IS NOT NULL
      AND pavu_assign.end_date <= p_as_of
    ORDER BY pavu_assign.end_date DESC
    LIMIT 1;

    IF FOUND THEN
      pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
      yarn_count := p.yarn_count; set_no := p.set_no;
      loaded_metre := p.meters;
      finished_metre := a.metres_produced;
      status_as_of := CASE
        WHEN p.status IN ('damaged', 'scrapped') THEN p.status
        WHEN a.status = 'completed' THEN 'finished'
        ELSE 'in_stock'
      END;
      mounted_date := a.start_date;
      finished_date := a.end_date;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Case 3: never assigned as of p_as_of.
    pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
    yarn_count := p.yarn_count; set_no := p.set_no;
    loaded_metre := p.meters;
    finished_metre := 0;
    status_as_of := CASE WHEN p.status IN ('damaged', 'scrapped') THEN p.status ELSE 'in_stock' END;
    mounted_date := NULL;
    finished_date := NULL;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION fn_pavu_stock_report(date) TO authenticated;
