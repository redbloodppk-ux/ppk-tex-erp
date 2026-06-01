-- 068_fabric_quality_fabric_type_to_text.sql
--
-- The new fabric_type_master lets the operator add custom fabric types
-- (dhoties, bedsheet, …) but fabric_quality.fabric_type is still a pg
-- enum that rejects anything outside woven/towel/dupatta. We migrate
-- the column to plain text so any master name can be stored. The pg
-- enum stays in place because costing_master.fabric_type still uses it.

BEGIN;

ALTER TABLE public.fabric_quality
  ALTER COLUMN fabric_type TYPE text
  USING fabric_type::text;

COMMENT ON COLUMN public.fabric_quality.fabric_type IS
  'Fabric category as free text. Source list is fabric_type_master.name (case-insensitive).';

COMMIT;
