-- 323: Qualities counted in a non-metre unit on the shift log.
-- Society saree (FQ-0008) is folded/counted in 137 cm "metres". The
-- operator keeps typing counted units; triggers store REAL metres in
-- metres_woven / adjustment_metres (so production, warp, stock reports
-- stay in metres) and keep the typed value in counted_metres /
-- adjustment_counted for the form. Wage rate on such looms is per REAL
-- metre (saree: Rs 10 / 5.5 m = Rs 1.82).
ALTER TABLE fabric_quality ADD COLUMN IF NOT EXISTS count_unit_cm numeric(6,2);
ALTER TABLE production_shift_log ADD COLUMN IF NOT EXISTS count_unit_cm numeric(6,2),
  ADD COLUMN IF NOT EXISTS adjustment_counted numeric(12,2);
ALTER TABLE production_shift_log_weaver ADD COLUMN IF NOT EXISTS counted_metres numeric(12,2);

-- fn_shift_log_snapshot_quality_rate(): also snapshots fq.count_unit_cm and,
-- when it is set and <> 100, converts adjustment_metres from counted units
-- (adjustment_counted keeps the typed value). Applied via CREATE OR REPLACE.

CREATE OR REPLACE FUNCTION public.fn_shift_log_weaver_count_unit()
 RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE v_cm numeric;
BEGIN
  SELECT p.count_unit_cm INTO v_cm FROM public.production_shift_log p WHERE p.id = NEW.shift_log_id;
  IF COALESCE(v_cm, 100) <> 100 AND v_cm > 0 THEN
    NEW.counted_metres := COALESCE(NEW.counted_metres, NEW.metres_woven);
    NEW.metres_woven   := round(NEW.counted_metres * v_cm / 100, 2);
  ELSE
    NEW.counted_metres := NULL;
  END IF;
  RETURN NEW;
END; $function$;

CREATE TRIGGER trg_shift_log_weaver_count_unit BEFORE INSERT ON public.production_shift_log_weaver
  FOR EACH ROW EXECUTE FUNCTION public.fn_shift_log_weaver_count_unit();

-- Data: FQ-0008 = 137 cm; L-55 rate Rs 1.82 / real m; 17-Oct log converted.
