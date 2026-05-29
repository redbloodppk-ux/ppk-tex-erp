-- 060_fabric_quality_consumption.sql
--
-- The Quick Calculator's Save & Submit now also creates a fabric_quality
-- row that snapshots per-metre consumption rates from the Derived Weights.
-- That gives downstream reports a self-describing view of how much
-- yarn / bobbin each metre of this fabric draws.

BEGIN;

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS costing_id        bigint REFERENCES public.costing_master(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS weft_kg_per_m     numeric(12,6),
  ADD COLUMN IF NOT EXISTS porvai_kg_per_m   numeric(12,6),
  ADD COLUMN IF NOT EXISTS bobbin_pcs_per_m  numeric(12,6);

CREATE INDEX IF NOT EXISTS idx_fabric_quality_costing_id ON public.fabric_quality(costing_id);

COMMENT ON COLUMN public.fabric_quality.costing_id       IS 'Source costing_master row this quality was generated from.';
COMMENT ON COLUMN public.fabric_quality.weft_kg_per_m    IS 'Snapshot: kg of weft yarn consumed per metre of fabric.';
COMMENT ON COLUMN public.fabric_quality.porvai_kg_per_m  IS 'Snapshot: kg of selvedge yarn consumed per metre of fabric.';
COMMENT ON COLUMN public.fabric_quality.bobbin_pcs_per_m IS 'Snapshot: bobbin pieces consumed per metre of fabric.';

COMMIT;
