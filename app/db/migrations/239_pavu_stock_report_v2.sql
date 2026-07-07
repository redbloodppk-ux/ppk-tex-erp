-- ============================================================================
-- 239: Beam Stock Report v2 — loom/shed columns, jobwork yarn-count/set-no
--      fallback, and manual 'finished' status respected.
--
-- Changes over migration 229:
--   1. New output columns loom_code + shed_no: the loom the beam is currently
--      mounted on (Case 1) or was last woven on (Case 2). Enables "show loom
--      no in status" and shed-wise filtering in the UI.
--   2. yarn_count falls back to jobwork_warp_beam.warp_count_id (matched via
--      pavu_id fk or the pavu_ids jsonb array) for jobwork beams that have no
--      sizing_job. set_no falls back to pavu.sizing_set_no likewise.
--   3. A pavu whose status was manually set to 'finished' (Pavu Master status
--      dropdown) now reports 'finished' instead of 'in_stock'. Like
--      damaged/scrapped, manual status changes aren't date-stamped, so this
--      always reflects the CURRENT status regardless of p_as_of — accepted
--      trade-off, documented in migration 229.
-- ============================================================================
DROP FUNCTION IF EXISTS fn_pavu_stock_report(date);

CREATE FUNCTION fn_pavu_stock_report(p_as_of date)
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
  finished_date  date,
  loom_code      text,
  shed_no        smallint
) AS $$
DECLARE
  p RECORD;
  a RECORD;
  v_weaver_sum numeric(12,2);
  v_adj_sum    numeric(12,2);
BEGIN
  FOR p IN
    SELECT pv.id, pv.pavu_code, pv.beam_no, pv.ends, pv.meters, pv.status, pv.created_at,
           COALESCE(wc.code, wcj.code)          AS yarn_count,
           COALESCE(sj.set_no, pv.sizing_set_no) AS set_no
    FROM pavu pv
    LEFT JOIN sizing_job sj ON sj.id = pv.sizing_job_id
    LEFT JOIN yarn_count wc ON wc.id = sj.warp_count_id
    -- Jobwork beams have no sizing_job: their warp count lives on the
    -- jobwork_warp_beam entry that references this pavu (single fk or
    -- jsonb id array).
    LEFT JOIN LATERAL (
      SELECT jwb.warp_count_id
      FROM jobwork_warp_beam jwb
      WHERE jwb.warp_count_id IS NOT NULL
        AND (jwb.pavu_id = pv.id OR jwb.pavu_ids @> to_jsonb(pv.id))
      ORDER BY jwb.id DESC
      LIMIT 1
    ) jw ON TRUE
    LEFT JOIN yarn_count wcj ON wcj.id = jw.warp_count_id
  LOOP
    -- Beam didn't exist yet as of the requested date — leave it out.
    IF p.created_at::date > p_as_of THEN
      CONTINUE;
    END IF;

    -- Case 1: an assignment actively covers p_as_of → on the loom.
    SELECT pa.*, l.loom_code AS a_loom_code, l.shed_no AS a_shed_no INTO a
    FROM pavu_assign pa
    JOIN loom l ON l.id = pa.loom_id
    WHERE pa.pavu_id = p.id
      AND pa.status IN ('mounted', 'running')
      AND pa.start_date IS NOT NULL
      AND pa.start_date <= p_as_of
      AND (pa.end_date IS NULL OR pa.end_date >= p_as_of)
    ORDER BY pa.start_date DESC
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
      loom_code := a.a_loom_code;
      shed_no := a.a_shed_no;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Case 2: most recent assignment that had already ended by p_as_of.
    SELECT pa.*, l.loom_code AS a_loom_code, l.shed_no AS a_shed_no INTO a
    FROM pavu_assign pa
    JOIN loom l ON l.id = pa.loom_id
    WHERE pa.pavu_id = p.id
      AND pa.end_date IS NOT NULL
      AND pa.end_date <= p_as_of
    ORDER BY pa.end_date DESC
    LIMIT 1;

    IF FOUND THEN
      pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
      yarn_count := p.yarn_count; set_no := p.set_no;
      loaded_metre := p.meters;
      finished_metre := a.metres_produced;
      status_as_of := CASE
        WHEN p.status IN ('damaged', 'scrapped', 'finished') THEN p.status
        WHEN a.status = 'completed' THEN 'finished'
        ELSE 'in_stock'
      END;
      mounted_date := a.start_date;
      finished_date := a.end_date;
      loom_code := a.a_loom_code;
      shed_no := a.a_shed_no;
      RETURN NEXT;
      CONTINUE;
    END IF;

    -- Case 3: never assigned as of p_as_of. Manual damaged/scrapped/finished
    -- statuses pass through (current status, not date-stamped).
    pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
    yarn_count := p.yarn_count; set_no := p.set_no;
    loaded_metre := p.meters;
    finished_metre := 0;
    status_as_of := CASE
      WHEN p.status IN ('damaged', 'scrapped', 'finished') THEN p.status
      ELSE 'in_stock'
    END;
    mounted_date := NULL;
    finished_date := NULL;
    loom_code := NULL;
    shed_no := NULL;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION fn_pavu_stock_report(date) TO authenticated;
