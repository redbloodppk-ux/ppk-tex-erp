-- production_shift_log rows only stored loom_id -- every report that
-- needs "quality" or "rate" for a historical row joined LIVE to the
-- loom table's CURRENT values. That's wrong for two reasons discovered
-- while investigating a wage discrepancy for SURESH S (EMP-0001):
--   1. Weekly Wage Summary (app/lib/wages/weekly-data.ts) computes
--      Wages Earned as metres x loom.default_rate_per_m -- reopening a
--      past week recalculates it at TODAY's rate, silently rewriting
--      the rupee figures of already-closed, already-paid weeks
--      whenever a loom's rate is edited later.
--   2. "Weaver Production by Quality" groups past production by
--      loom.fabric_quality_id (today's assignment), which is wrong if
--      the loom's quality changed since then.
--
-- Fix: freeze the quality + rate onto the shift-log row itself, at
-- insert time, via a BEFORE INSERT trigger. The trigger never fires on
-- UPDATE, so a row's snapshot cannot be altered later by editing the
-- loom master.
--
-- This migration also backfills real historical values for 10 looms
-- whose quality and/or rate changed on 2026-06-29 and 2026-07-05 (no
-- audit trail exists for the loom table, so these values come from the
-- user's own records -- see
-- docs/superpowers/specs/2026-07-05-shift-log-quality-rate-snapshot-design.md).

ALTER TABLE public.production_shift_log
  ADD COLUMN IF NOT EXISTS fabric_quality_id integer REFERENCES public.fabric_quality(id),
  ADD COLUMN IF NOT EXISTS rate_per_m numeric;

COMMENT ON COLUMN public.production_shift_log.fabric_quality_id IS 'Fabric quality in effect on this loom on this date, frozen at insert time by trg_shift_log_snapshot_quality_rate. Independent of the loom''s current/live fabric_quality_id.';
COMMENT ON COLUMN public.production_shift_log.rate_per_m IS 'Wage rate per metre in effect on this loom on this date, frozen at insert time by trg_shift_log_snapshot_quality_rate. Independent of the loom''s current/live default_rate_per_m.';

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
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shift_log_snapshot_quality_rate ON public.production_shift_log;
CREATE TRIGGER trg_shift_log_snapshot_quality_rate
  BEFORE INSERT ON public.production_shift_log
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_shift_log_snapshot_quality_rate();

-- Backfill pass 1 (baseline): every existing row gets its loom's
-- CURRENT quality/rate as a best-effort historical value. This is the
-- same approximation already implicitly in use today for every loom
-- other than the 10 below.
UPDATE public.production_shift_log psl
SET fabric_quality_id = l.fabric_quality_id,
    rate_per_m = l.default_rate_per_m
FROM public.loom l
WHERE l.id = psl.loom_id;

-- Backfill pass 2: Group A looms (L-08, L-35, L-36, L-40, L-41 / ids
-- 64, 91, 92, 96, 97) -- quality AND rate both changed on 2026-07-05.
-- Pre-change rows get the OLD quality (DOBBY-OE-TOWEL-31, id 3) + OLD
-- rate (1.77).
UPDATE public.production_shift_log
SET fabric_quality_id = 3,
    rate_per_m = 1.77
WHERE loom_id IN (64, 91, 92, 96, 97)
  AND log_date < '2026-07-05';

-- Backfill pass 3: Group B looms (L-09, L-32, L-33, L-34, L-37 / ids
-- 65, 88, 89, 90, 93) -- rate only changed on 2026-06-29; quality never
-- changed for this group (stays id 3, already correct from pass 1).
UPDATE public.production_shift_log
SET rate_per_m = 1.77
WHERE loom_id IN (65, 88, 89, 90, 93)
  AND log_date < '2026-06-29';
