-- Mounted metre (pavu_assign.metres_produced) currently sums raw operator-
-- entered metres as-is. For towel products, the raw entered figure needs a
-- "towel length / 2" (TL/2) conversion before it counts toward mounted
-- metre (e.g. towel length 1.7 -> multiplier 0.85). The shift log itself
-- stays raw/unconverted -- only the mounted-metre aggregation converts.
--
-- Same historical-correctness problem as migration 233 (quality/rate
-- snapshot): a fabric_quality's towel length can be edited later, and a
-- live lookup would retroactively change the conversion applied to
-- already-logged historical shifts. Fix: freeze is_towel/towel_meter_per_pc
-- onto production_shift_log at insert time too, reusing the same
-- trg_shift_log_snapshot_quality_rate trigger and the loom's frozen
-- fabric_quality_id (already established by migration 233).
--
-- "Is towel" check matches migration 216
-- (216_so_refresh_status_towel_by_type.sql): fabric_type = 'towel' AND
-- meter_per_pc > 0 -- meter_per_pc alone is not sufficient, since some
-- non-towel qualities also carry a meter_per_pc value.
--
-- See docs/superpowers/specs/2026-07-06-mounted-metre-towel-conversion-design.md
-- for the full design.

ALTER TABLE public.production_shift_log
  ADD COLUMN IF NOT EXISTS is_towel boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS towel_meter_per_pc numeric;

COMMENT ON COLUMN public.production_shift_log.is_towel IS 'Whether this shift''s fabric_quality_id was a towel product (fabric_type=''towel'' AND meter_per_pc>0), frozen at insert time by trg_shift_log_snapshot_quality_rate.';
COMMENT ON COLUMN public.production_shift_log.towel_meter_per_pc IS 'Towel length (fabric_quality.meter_per_pc) in effect at insert time, frozen by trg_shift_log_snapshot_quality_rate. Used by fn_recompute_pavu_assign_metres to apply the TL/2 mounted-metre conversion. NULL/irrelevant when is_towel=false.';

-- Extend the existing snapshot trigger (migration 233) to also freeze the
-- towel fields, derived from the just-resolved fabric_quality_id.
CREATE OR REPLACE FUNCTION public.fn_shift_log_snapshot_quality_rate()
RETURNS trigger AS $$
BEGIN
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_log_snapshot_quality_rate ON public.production_shift_log;
CREATE TRIGGER trg_shift_log_snapshot_quality_rate
  BEFORE INSERT ON public.production_shift_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shift_log_snapshot_quality_rate();

-- Backfill pass 1 (baseline): every existing row gets its ALREADY-FROZEN
-- fabric_quality_id's CURRENT towel fields (same best-effort approximation
-- migration 233 used for quality/rate).
UPDATE public.production_shift_log psl
SET is_towel = (fq.fabric_type = 'towel' AND COALESCE(fq.meter_per_pc, 0) > 0),
    towel_meter_per_pc = fq.meter_per_pc
FROM public.fabric_quality fq
WHERE fq.id = psl.fabric_quality_id;

-- Backfill pass 2: DOBBY-OE-TOWEL-31 (fabric_quality id 3) -- towel length
-- changed from 1.4 to 1.7 starting 2026-06-30 (per user's own records, no
-- audit trail exists for fabric_quality). Rows logged before that date get
-- the OLD towel length (1.4); rows on/after keep pass 1's current value
-- (1.7).
UPDATE public.production_shift_log
SET towel_meter_per_pc = 1.4
WHERE fabric_quality_id = 3
  AND log_date < '2026-06-30';

-- Update fn_recompute_pavu_assign_metres (migration 227/228) to apply the
-- TL/2 conversion to both metres_woven (per weaver) and adjustment_metres
-- (per shift-log row), using each row's own frozen towel snapshot. Non-towel
-- rows keep multiplier 1 (unchanged behavior).
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

    SELECT COALESCE(SUM(
      w.metres_woven * CASE
        WHEN s.is_towel AND s.towel_meter_per_pc IS NOT NULL THEN s.towel_meter_per_pc / 2.0
        ELSE 1
      END
    ), 0) INTO v_weaver_sum
    FROM production_shift_log_weaver w
    JOIN production_shift_log s ON s.id = w.shift_log_id
    WHERE s.loom_id = p_loom_id
      AND s.log_date >= v_window_start
      AND s.log_date <= COALESCE(r.end_date, CURRENT_DATE);

    SELECT COALESCE(SUM(
      s.adjustment_metres * CASE
        WHEN s.is_towel AND s.towel_meter_per_pc IS NOT NULL THEN s.towel_meter_per_pc / 2.0
        ELSE 1
      END
    ), 0) INTO v_adj_sum
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

-- Refresh every loom's pavu_assign.metres_produced now that the conversion
-- (and the towel backfill above) is in place.
DO $$
DECLARE
  v_loom_id bigint;
BEGIN
  FOR v_loom_id IN SELECT DISTINCT loom_id FROM production_shift_log LOOP
    PERFORM fn_recompute_pavu_assign_metres(v_loom_id);
  END LOOP;
END $$;
