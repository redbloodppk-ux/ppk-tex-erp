-- ============================================================================
-- 308: A new shift-log row takes its quality from the BEAM on the loom that
--      day, and only falls back to the loom's master setting.
--
-- PPK, 2026-09-26: "Loom L-31, 23 Sep: Cotton Thalapathy 34 not 31".
-- Beam 3767 (34") was on L-31 on 23 Sep, but the loom master still said
-- 30", and fn_shift_log_snapshot_quality_rate froze the loom master value.
-- The shift-log screen showed an amber hint, but the save ignored it.
--
-- The beam mount (pavu_assign) is the better witness of what was woven, and
-- fn_loom_quality_on_date already resolves it (costing quality for in-house
-- beams, jobwork_warp_beam quality for jobwork beams). This adds an id-
-- returning twin and uses it first.
--
-- Only affects rows inserted without an explicit fabric_quality_id (the
-- shift-log screen never sends one). Existing rows are untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_loom_quality_id_on_date(p_loom_id bigint, p_date date)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(fq_c.id, fq_j.id)
  FROM pavu_assign pa
  JOIN pavu pv ON pv.id = pa.pavu_id
  LEFT JOIN costing_master cm
         ON cm.id = pa.costing_id
        AND cm.quality_code <> 'JOBWORK-EXEMPT'
  LEFT JOIN fabric_quality fq_c ON fq_c.costing_id = cm.id
  LEFT JOIN LATERAL (
    SELECT fq.id
    FROM jobwork_warp_beam jwb
    JOIN fabric_quality fq ON fq.id = jwb.fabric_quality_id
    WHERE jwb.pavu_id = pv.id OR jwb.pavu_ids @> to_jsonb(pv.id)
    ORDER BY jwb.id DESC
    LIMIT 1
  ) fq_j ON TRUE
  WHERE pa.loom_id = p_loom_id
    AND pa.start_date IS NOT NULL
    AND pa.start_date <= p_date
    AND (pa.end_date IS NULL OR pa.end_date >= p_date)
    AND COALESCE(fq_c.id, fq_j.id) IS NOT NULL
  ORDER BY pa.start_date DESC, pa.id DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.fn_loom_quality_id_on_date(bigint, date) IS
  'fabric_quality.id of the beam mounted on the loom on that date (same rules as fn_loom_quality_on_date), or NULL.';

CREATE OR REPLACE FUNCTION public.fn_shift_log_snapshot_quality_rate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.fabric_quality_id IS NULL THEN
    NEW.fabric_quality_id := public.fn_loom_quality_id_on_date(NEW.loom_id, NEW.log_date);
  END IF;

  IF NEW.fabric_quality_id IS NULL OR NEW.rate_per_m IS NULL THEN
    SELECT
      COALESCE(NEW.fabric_quality_id, l.fabric_quality_id),
      COALESCE(NEW.rate_per_m, l.default_rate_per_m)
    INTO NEW.fabric_quality_id, NEW.rate_per_m
    FROM public.loom l
    WHERE l.id = NEW.loom_id;
  END IF;

  IF NEW.fabric_quality_id IS NOT NULL THEN
    SELECT
      (fq.fabric_type = 'towel' AND COALESCE(fq.meter_per_pc, 0) > 0),
      fq.meter_per_pc
    INTO NEW.is_towel, NEW.towel_meter_per_pc
    FROM public.fabric_quality fq
    WHERE fq.id = NEW.fabric_quality_id;
  END IF;

  RETURN NEW;
END;
$$;
