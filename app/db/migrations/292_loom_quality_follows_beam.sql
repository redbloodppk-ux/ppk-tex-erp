-- ============================================================================
-- 292: When a beam goes on a loom, the loom's quality follows it.
--
-- PPK, 2026-09-09, after the warp-stock investigation: "check that also".
--
-- WHY
-- fn_shift_log_snapshot_quality_rate fills a shift log's quality from the
-- LOOM when the entry does not carry one of its own. Nothing kept the
-- loom's setting in step with the beam actually on it, so once a loom's
-- setting went stale every log for that run inherited the wrong quality -
-- silently, for as long as the beam ran.
--
-- Two beams ran their entire life that way:
--
--   L-10  beam 3768   4 Jul - 1 Aug   12 logs  ~1,227 m
--         logged COTTON THALAPATHY 72 X 46 = 34"; the beam is LUREX TOWEL
--   L-37  beam 2426  11 Jul - 8 Aug   11 logs  ~1,115 m
--         logged OE THALAPATHY 62 X 46 = 30"; the beam is COTTON
--         THALAPATHY 72 X 46 = 34"
--
-- That is ~2,340 m credited to the wrong quality. It does not disturb the
-- beam metres - both beams read under 100% - but it flows straight into
-- profit-by-quality and costing, where a quality appears to have produced
-- cloth it never wove.
--
-- It is also the same root as the complaint that started this: PPK,
-- 2026-09-04, "loom no 34 why its showing wrong quality?". Migration 281
-- fixed how a past date is DISPLAYED. This fixes what gets STORED.
--
-- WHAT IT DOES
-- On a live mount - status mounted/running with no end date - the loom's
-- fabric_quality_id is set to the beam's own quality, resolved the same
-- way fn_loom_quality_on_date resolves it (the assign's costing first,
-- then the jobwork warp beam). One notion of "what quality is this beam",
-- not a second one written here.
--
-- Only fabric_quality_id moves. default_rate_per_m is left alone: what a
-- weaver is paid per metre is a decision, not something to infer from a
-- beam change.
--
-- If the beam's quality cannot be resolved the loom is left untouched,
-- because a stale setting is still better than no setting - a log saved
-- against a NULL quality gets no snapshot at all.
--
-- SCOPE: new mounts only. Checked before applying: all 56 looms currently
-- agree with the beam on them, so there is nothing to correct and this is
-- purely preventive. The July history stays as it is, consistent with
-- PPK's standing instruction on the beam overlaps (migration 277).
--
-- The shift log screen also now shows an amber warning when the quality it
-- is about to save differs from the beam on that loom, so a beam change
-- recorded a day or two late is caught by eye as well.
-- See app/app/production/shift-log/page.tsx.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_loom_quality_follows_beam()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_quality_id bigint;
BEGIN
  -- Only a beam actually going on a loom. An ended row is history, and a
  -- queued row is a plan.
  IF NEW.end_date IS NOT NULL OR NEW.status NOT IN ('mounted', 'running') THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(fq_c.id, fq_j.id) INTO v_quality_id
  FROM public.pavu pv
  LEFT JOIN public.costing_master cm
         ON cm.id = NEW.costing_id
        AND cm.quality_code <> 'JOBWORK-EXEMPT'
  LEFT JOIN public.fabric_quality fq_c ON fq_c.costing_id = cm.id
  LEFT JOIN LATERAL (
    SELECT fq.id
    FROM public.jobwork_warp_beam jwb
    JOIN public.fabric_quality fq ON fq.id = jwb.fabric_quality_id
    WHERE jwb.pavu_id = pv.id OR jwb.pavu_ids @> to_jsonb(pv.id)
    ORDER BY jwb.id DESC
    LIMIT 1
  ) fq_j ON TRUE
  WHERE pv.id = NEW.pavu_id;

  -- Unresolvable quality: leave the loom alone. A stale setting still
  -- produces a snapshot; a NULL one produces none.
  IF v_quality_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.loom
  SET fabric_quality_id = v_quality_id
  WHERE id = NEW.loom_id
    AND fabric_quality_id IS DISTINCT FROM v_quality_id;

  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS trg_loom_quality_follows_beam ON public.pavu_assign;
CREATE TRIGGER trg_loom_quality_follows_beam
  AFTER INSERT OR UPDATE ON public.pavu_assign
  FOR EACH ROW EXECUTE FUNCTION public.fn_loom_quality_follows_beam();

COMMENT ON FUNCTION public.fn_loom_quality_follows_beam() IS
  'Keeps loom.fabric_quality_id in step with the beam mounted on it, so a shift log saved without a quality does not inherit a stale one. See migration 292.';

-- Verify:
--   select q.loom_code, q.quality_name, fq.name
--   from fn_loom_quality_on_date(current_date) q
--   join loom l on l.id = q.loom_id
--   left join fabric_quality fq on fq.id = l.fabric_quality_id
--   where fq.name is distinct from q.quality_name;
-- Expected: no rows.
