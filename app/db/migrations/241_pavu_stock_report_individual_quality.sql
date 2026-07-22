-- ============================================================================
-- 241: Beam Stock Report — stop collapsing quality names to merged_name,
--      and fix finished-metre undercount for beams with multiple mount
--      cycles.
--
-- Quality: fn_pavu_stock_report's 3-tier quality-resolution cascade (costing
-- via pavu_assign, jobwork_warp_beam fallback, ends+yarn-count fallback) was
-- merge-aware — whenever the resolved fabric_quality row had is_merged AND
-- merged_name set, the merged group name (e.g. "20'S DHOTIES") replaced the
-- individual quality name (e.g. "WHITE DHOTIES 2190" / "BLACK DHOTIES 2190").
-- That's the right behaviour for costing/consolidation, but wrong for this
-- report: the owner needs to see which INDIVIDUAL quality is actually
-- mounted on a beam, and the merged label makes that impossible to tell.
-- All three tiers now always surface the individual fabric_quality.name.
--
-- Finished metres: the "beam finished, no longer on loom" branch picked the
-- single pavu_assign row with the latest end_date <= p_as_of and used only
-- that row's metres_produced. Beams that were mounted, removed, and later
-- re-mounted/removed again (multiple pavu_assign rows for the same pavu)
-- silently lost every earlier cycle's metres — e.g. beam 3296 (pavu 115)
-- had a 500m cycle (01-15 Jul) followed by a 234m cycle (15-19 Jul), and the
-- report only showed 234m instead of the true 734m total. Finished_metre
-- for the historical branch is now the SUM of metres_produced across every
-- pavu_assign row for that pavu with end_date <= p_as_of, matching how the
-- 'on_loom' branch already aggregates production from shift logs rather
-- than trusting a single row.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pavu_stock_report(p_as_of date)
 RETURNS TABLE(pavu_id bigint, pavu_code text, beam_no text, ends integer, yarn_count text, set_no text, quality text, loaded_metre numeric, finished_metre numeric, status_as_of text, mounted_date date, finished_date date, loom_code text, shed_no smallint, production_mode text)
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  p RECORD;
  a RECORD;
  v_weaver_sum numeric(12,2);
  v_adj_sum    numeric(12,2);
  v_hist_sum   numeric(12,2);
BEGIN
  FOR p IN
    SELECT pv.id, pv.pavu_code, pv.beam_no, pv.ends, pv.meters, pv.status, pv.created_at,
           pv.production_mode,
           COALESCE(wc.code, wcj.code)          AS yarn_count,
           COALESCE(sj.set_no, pv.sizing_set_no) AS set_no,
           COALESCE(qa.quality_name, qj.quality_name, qe.quality_name) AS quality
    FROM pavu pv
    LEFT JOIN sizing_job sj ON sj.id = pv.sizing_job_id
    LEFT JOIN yarn_count wc ON wc.id = sj.warp_count_id
    LEFT JOIN LATERAL (
      SELECT jwb.warp_count_id
      FROM jobwork_warp_beam jwb
      WHERE jwb.warp_count_id IS NOT NULL
        AND (jwb.pavu_id = pv.id OR jwb.pavu_ids @> to_jsonb(pv.id))
      ORDER BY jwb.id DESC
      LIMIT 1
    ) jw ON TRUE
    LEFT JOIN yarn_count wcj ON wcj.id = jw.warp_count_id
    -- Quality is always resolved through fabric_quality — the canonical
    -- master (with its merged-name grouping) — never from costing_master's
    -- own free-typed quality_name, which is just a copy made at costing
    -- time and can drift out of sync (different wording, or missed a
    -- later merge). fabric_quality.costing_id links a quality row back to
    -- the costing it was generated from. cm.quality_name is kept only as
    -- a last-resort safety net if a costing has no linked fabric_quality
    -- row at all. NOTE: this report always shows the INDIVIDUAL quality
    -- name — merged_name is intentionally never substituted here (see
    -- migration 241) so distinct qualities sharing a merge group (e.g.
    -- WHITE DHOTIES 2190 vs BLACK DHOTIES 2190) stay distinguishable.
    LEFT JOIN LATERAL (
      SELECT pa.id AS pa_id, cm.id AS cm_id, cm.quality_name AS cm_quality_name
      FROM pavu_assign pa
      JOIN costing_master cm ON cm.id = pa.costing_id
      WHERE pa.pavu_id = pv.id
        AND cm.quality_code <> 'JOBWORK-EXEMPT'
      ORDER BY pa.id DESC
      LIMIT 1
    ) a_cm ON TRUE
    LEFT JOIN fabric_quality fq_a ON fq_a.costing_id = a_cm.cm_id
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN a_cm.cm_id IS NULL THEN NULL
               ELSE COALESCE(fq_a.name, a_cm.cm_quality_name)
             END AS quality_name
    ) qa ON TRUE
    LEFT JOIN LATERAL (
      SELECT jwb.id AS jwb_id, fq.name AS fq_name, fq.is_merged, fq.merged_name
      FROM jobwork_warp_beam jwb
      JOIN fabric_quality fq ON fq.id = jwb.fabric_quality_id
      WHERE (jwb.pavu_id = pv.id OR jwb.pavu_ids @> to_jsonb(pv.id))
      ORDER BY jwb.id DESC
      LIMIT 1
    ) j_fq ON TRUE
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN j_fq.jwb_id IS NULL THEN NULL
               ELSE j_fq.fq_name
             END AS quality_name
    ) qj ON TRUE
    -- Fallback when this beam has never been costed/assigned directly:
    -- match on BOTH ends and yarn count (warp_count_id), not just ends.
    -- Multiple qualities can share the same ends with a different yarn
    -- count (e.g. COLOR OE vs OE THALAPATHY both at 1770 ends), so
    -- matching on ends alone can silently pick the wrong quality.
    LEFT JOIN LATERAL (
      SELECT cm.id AS cm_id, cm.quality_name AS cm_quality_name
      FROM costing_master cm
      WHERE cm.warp_ends = pv.ends
        AND cm.quality_code <> 'JOBWORK-EXEMPT'
        AND cm.warp_count_id = COALESCE(wc.id, wcj.id)
      ORDER BY cm.id DESC
      LIMIT 1
    ) e_cm ON TRUE
    LEFT JOIN fabric_quality fq_e ON fq_e.costing_id = e_cm.cm_id
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN e_cm.cm_id IS NULL THEN NULL
               ELSE COALESCE(fq_e.name, e_cm.cm_quality_name)
             END AS quality_name
    ) qe ON TRUE
  LOOP
    IF p.created_at::date > p_as_of THEN
      CONTINUE;
    END IF;

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
      yarn_count := p.yarn_count; set_no := p.set_no; quality := p.quality;
      loaded_metre := p.meters;
      finished_metre := v_weaver_sum + v_adj_sum;
      status_as_of := 'on_loom';
      mounted_date := a.start_date;
      finished_date := NULL;
      loom_code := a.a_loom_code;
      shed_no := a.a_shed_no;
      production_mode := p.production_mode;
      RETURN NEXT;
      CONTINUE;
    END IF;

    SELECT pa.*, l.loom_code AS a_loom_code, l.shed_no AS a_shed_no INTO a
    FROM pavu_assign pa
    JOIN loom l ON l.id = pa.loom_id
    WHERE pa.pavu_id = p.id
      AND pa.end_date IS NOT NULL
      AND pa.end_date <= p_as_of
    ORDER BY pa.end_date DESC
    LIMIT 1;

    IF FOUND THEN
      -- Sum across EVERY ended assign cycle for this pavu, not just the
      -- most recent one — a beam can be mounted, removed, and remounted
      -- more than once, and each cycle's metres_produced must count
      -- toward the beam's total finished metres.
      SELECT COALESCE(SUM(pa2.metres_produced), 0) INTO v_hist_sum
      FROM pavu_assign pa2
      WHERE pa2.pavu_id = p.id
        AND pa2.end_date IS NOT NULL
        AND pa2.end_date <= p_as_of;

      pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
      yarn_count := p.yarn_count; set_no := p.set_no; quality := p.quality;
      loaded_metre := p.meters;
      finished_metre := v_hist_sum;
      status_as_of := CASE
        WHEN p.status IN ('damaged', 'scrapped', 'finished') THEN p.status
        WHEN a.status = 'completed' THEN 'finished'
        ELSE 'in_stock'
      END;
      mounted_date := a.start_date;
      finished_date := a.end_date;
      loom_code := a.a_loom_code;
      shed_no := a.a_shed_no;
      production_mode := p.production_mode;
      RETURN NEXT;
      CONTINUE;
    END IF;

    pavu_id := p.id; pavu_code := p.pavu_code; beam_no := p.beam_no; ends := p.ends;
    yarn_count := p.yarn_count; set_no := p.set_no; quality := p.quality;
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
    production_mode := p.production_mode;
    RETURN NEXT;
  END LOOP;
END;
$function$;
