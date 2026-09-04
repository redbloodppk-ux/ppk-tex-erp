-- ============================================================================
-- 281: What was each loom weaving on a given DATE?
--
-- PPK, 2026-09-04: "loom no 34 supposed to display OE THALAPATHY 60 X 46 = 30
-- on 2/9/26 but it showing COTTON THALAPATHY 60 X 46 = 31 why?"
--
-- Because the shift-log screen, for a date with no saved log, fell back to
-- the loom's CURRENT quality. Beam 2420 (OE) ran on L-34 until 3 Sep, when
-- 5409 (Cotton) replaced it — so 2 Sep was labelled with the 3rd's beam.
--
-- fn_pavu_stock_report could not answer this: its 'on_loom' branch requires
-- status mounted/running, and 2420 is 'completed', so asking it about 2 Sep
-- returns nothing for L-34. It reports where beams are NOW, not what a loom
-- was weaving THEN.
--
-- So: a function that answers the date question directly, from the mount
-- windows, whatever the assignment's status is today.
--
-- QUALITY RESOLUTION
-- Mirrors the first two tiers of the stock report's cascade:
--   1. the assignment's costing -> fabric_quality.costing_id -> name
--      (the reliable link; costing_master.quality_name is a free-typed copy
--      and was wrong on three of six costings — see migration 280)
--   2. jobwork_warp_beam.fabric_quality_id -> name, for jobwork beams
-- The report's third tier (guess from ends + yarn count) is deliberately
-- NOT copied. Here a NULL simply means "not known", and the screen falls
-- back to the loom's own setting; guessing would put a fabricated quality
-- against a historical date, which is the class of thing that started this.
--
-- Agreement with the stock report is verified by test rather than by shared
-- code: all 56 currently-mounted looms resolve identically. Folding the
-- report onto this function is worth doing, but not in the same change as
-- a bug fix.
--
-- Verified after applying:
--   L-34 on 2026-09-02 -> beam 2420, OE THALAPATHY 62 X 46 = 30"
--   L-34 on 2026-09-03 -> beam 5409, COTTON THALAPATHY 60 X 46 = 30"
--   56 looms compared against fn_pavu_stock_report today, 0 disagree
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_loom_quality_on_date(p_date date)
RETURNS TABLE (
  loom_id      bigint,
  loom_code    text,
  pavu_id      bigint,
  beam_no      text,
  quality_name text
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (l.id)
    l.id, l.loom_code, pv.id, pv.beam_no,
    COALESCE(fq_c.name, fq_j.name)
  FROM pavu_assign pa
  JOIN loom l ON l.id = pa.loom_id
  JOIN pavu pv ON pv.id = pa.pavu_id
  LEFT JOIN costing_master cm
         ON cm.id = pa.costing_id
        AND cm.quality_code <> 'JOBWORK-EXEMPT'
  LEFT JOIN fabric_quality fq_c ON fq_c.costing_id = cm.id
  LEFT JOIN LATERAL (
    SELECT fq.name
    FROM jobwork_warp_beam jwb
    JOIN fabric_quality fq ON fq.id = jwb.fabric_quality_id
    WHERE jwb.pavu_id = pv.id OR jwb.pavu_ids @> to_jsonb(pv.id)
    ORDER BY jwb.id DESC
    LIMIT 1
  ) fq_j ON TRUE
  WHERE pa.start_date IS NOT NULL
    AND pa.start_date <= p_date
    AND (pa.end_date IS NULL OR pa.end_date >= p_date)
  -- Latest mount wins on a changeover day, matching the stock report, which
  -- also orders by start_date DESC when two rows cover the same day.
  ORDER BY l.id, pa.start_date DESC, pa.id DESC;
$$;

COMMENT ON FUNCTION public.fn_loom_quality_on_date(date) IS
  'Beam and quality on each loom as at a given date, from the mount windows regardless of the assignment''s status today. Used by the shift-log screen so a past date is not labelled with the loom''s current cloth. NULL quality means unknown - never guessed. See migration 281.';

-- Verify:
--   select * from fn_loom_quality_on_date('2026-09-02') where loom_code='L-34';
-- Expected: beam 2420, OE THALAPATHY 62 X 46 = 30"
