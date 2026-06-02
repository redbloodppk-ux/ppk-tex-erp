-- 078_fabric_quality_pick_cost_per_m.sql
--
-- Adds fabric_quality.pick_cost_per_m (numeric) so each fabric quality
-- can record the pick yarn cost allocated per metre of fabric. Manually
-- entered on the Fabric Quality form; used downstream in costing /
-- per-metre rate calculations.

BEGIN;

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS pick_cost_per_m numeric(12,4);

COMMENT ON COLUMN public.fabric_quality.pick_cost_per_m IS
  'Pick yarn cost per metre of fabric (Rs/m). Entered on Fabric Quality form.';

COMMIT;
