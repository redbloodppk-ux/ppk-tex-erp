-- ============================================================================
-- 291: A beam on the loom must be measured in the same unit as one that
--      has come off it.
--
-- PPK, 2026-09-08: "90 metres not towel which is in 100cm so we multiply
-- with .85 for conversion to 85 cm".
--
-- THE BUG
-- fn_pavu_stock_report answers "how much has this beam woven" two
-- different ways, and they are in two different units:
--
--   beam still ON THE LOOM   SUM(production_shift_log_weaver.metres_woven)
--                            raw, straight out of the shift log
--   beam already FINISHED    SUM(pavu_assign.metres_produced), which
--                            fn_recompute_pavu_assign_metres builds WITH
--                            the conversion applied
--
-- So a towel beam silently changed unit the moment it came off the loom.
--
-- WHY THE CONVERSION EXISTS
-- The shift log records metres of production - PPK's 100 cm metre. The
-- beam is measured in the towel's own unit, 85 cm for a 1.70 m towel and
-- 82.5 cm for a 1.65 m one, which is meter_per_pc / 2. Both figures are
-- real; they are simply not the same ruler, and the report was holding
-- one against the other.
--
-- WHAT IT MEANT IN PRACTICE
-- L-31, beam 3767, loaded 1,280:
--   raw log sum          908.0   -> 372.0 m "remaining"   (what it showed)
--   converted            771.8   -> 508.2 m remaining     (the truth)
--
-- Every towel beam currently on a loom was reported as having woven
-- about 18% more than it had, and as holding about 18% less warp than it
-- does.
--
-- IT DOES NOT EXPLAIN THE BEAMS OVER 100% WOVEN. That was my guess before
-- applying this, and checking afterwards disproved it: 35 beams still
-- read over 100%, and nearly all are finished ones on non-towel
-- qualities - CONGRESS RUNNING FABRIC, WHITE / BLACK DHOTIES, DOBBY KAVI
-- - where the conversion factor is 1 and nothing changed. They take the
-- stored metres_produced, which was already converted. Their cause is
-- the separate attribution problem: both this function and the recompute
-- sum shift logs by LOOM over a date window rather than by beam, so a
-- changeover day lends metres to whichever beam the window covers. Most
-- sit at 100-115%, consistent with a day or two of the neighbouring
-- beam; 3324 at 146% is its own outlier. Left alone here - PPK deferred
-- it, and it wants fixing at the source rather than in a report.
--
-- THE FIX
-- Use the same CASE the recompute function already uses, so there is one
-- conversion in the system rather than a converted path and a raw one.
-- Nothing else in the function changes.
--
-- NOT DONE: no stored figure is rewritten. pavu_assign.metres_produced
-- was right all along - it was the live branch that was wrong - so there
-- is nothing to backfill. The warehouse warp-stock closing balance picks
-- the correction up automatically, since it reads this function.
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
      -- MIGRATION 291. The shift log holds metres of production - PPK's
      -- 100 cm metre. A towel beam is measured in the towel's own unit,
      -- meter_per_pc / 2 (85 cm for a 1.70 m towel). Without this the
      -- live figure was raw production metres while the finished-beam
      -- branch below was already converted, so a beam changed unit the
      -- moment it came off the loom. Same CASE as
      -- fn_recompute_pavu_assign_metres, deliberately - one conversion.
      SELECT COALESCE(SUM(
        w.metres_woven * CASE
          WHEN s.is_towel AND s.towel_meter_per_pc IS NOT NULL THEN s.towel_meter_per_pc / 2.0
          ELSE 1
        END
      ), 0) INTO v_weaver_sum
      FROM production_shift_log_weaver w
      JOIN production_shift_log s ON s.id = w.shift_log_id
      WHERE s.loom_id = a.loom_id
        AND s.log_date >= COALESCE(a.metres_start_date, a.start_date)
        AND s.log_date <= p_as_of;

      SELECT COALESCE(SUM(
        s.adjustment_metres * CASE
          WHEN s.is_towel AND s.towel_meter_per_pc IS NOT NULL THEN s.towel_meter_per_pc / 2.0
          ELSE 1
        END
      ), 0) INTO v_adj_sum
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

-- Verify:
--   select beam_no, loaded_metre, finished_metre,
--          loaded_metre - finished_metre as remaining
--   from fn_pavu_stock_report(current_date) where beam_no = '3767';
-- Expected: 1280 loaded, 771.8 woven, 508.2 remaining — matching
-- pavu_assign.metres_produced, which was right all along.
