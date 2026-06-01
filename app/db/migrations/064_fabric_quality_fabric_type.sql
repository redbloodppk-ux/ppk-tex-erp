-- 064_fabric_quality_fabric_type.sql
--
-- Adds fabric_type to fabric_quality so the Fabric Quality form can
-- categorise each saved fabric as woven / towel / dupatta. Reuses the
-- existing `fabric_type` enum already used by costing_master.

BEGIN;

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS fabric_type public.fabric_type;

COMMENT ON COLUMN public.fabric_quality.fabric_type IS
  'Type of fabric: woven, towel, or dupatta. Drives downstream classification.';

COMMIT;
