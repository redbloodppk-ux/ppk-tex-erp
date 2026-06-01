-- 065_fabric_quality_production_mode.sql
--
-- Adds a production-mode column to fabric_quality so each saved fabric
-- can be tagged as woven in-house, sent out as job work, or fully
-- outsourced. Uses a new enum (fabric_production_mode) so we don't have
-- to widen the existing production_mode enum on costing_master.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fabric_production_mode') THEN
    CREATE TYPE public.fabric_production_mode AS ENUM ('inhouse', 'job_work', 'outsourcing');
  END IF;
END $$;

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS production_mode public.fabric_production_mode;

COMMENT ON COLUMN public.fabric_quality.production_mode IS
  'How this fabric is produced: inhouse (own looms), job_work (vendor weaves on our yarn), or outsourcing (buy finished fabric).';

COMMIT;
