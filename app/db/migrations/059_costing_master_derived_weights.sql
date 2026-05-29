-- 059_costing_master_derived_weights.sql
--
-- The Quick Calculator's Save & Submit now snapshots the Derived Weights
-- panel into costing_master so the saved row is self-describing.
-- Reports can show the weight directly without recomputing every time.

BEGIN;

ALTER TABLE public.costing_master
  ADD COLUMN IF NOT EXISTS warp_m_per_kg     numeric(12,4),
  ADD COLUMN IF NOT EXISTS warp_kg_per_m     numeric(12,6),
  ADD COLUMN IF NOT EXISTS weft_m_per_kg     numeric(12,4),
  ADD COLUMN IF NOT EXISTS weft_kg_per_m     numeric(12,6),
  ADD COLUMN IF NOT EXISTS porvai_m_per_kg   numeric(12,4),
  ADD COLUMN IF NOT EXISTS porvai_kg_per_m   numeric(12,6),
  ADD COLUMN IF NOT EXISTS grams_per_m       numeric(10,2),
  ADD COLUMN IF NOT EXISTS gsm               numeric(10,2);

COMMENT ON COLUMN public.costing_master.warp_m_per_kg   IS 'Snapshot: metres of fabric per kg of warp yarn.';
COMMENT ON COLUMN public.costing_master.weft_m_per_kg   IS 'Snapshot: metres of fabric per kg of weft yarn.';
COMMENT ON COLUMN public.costing_master.porvai_m_per_kg IS 'Snapshot: metres of fabric per kg of selvedge yarn.';
COMMENT ON COLUMN public.costing_master.grams_per_m     IS 'Snapshot: total fabric weight per metre.';
COMMENT ON COLUMN public.costing_master.gsm             IS 'Snapshot: grams per square metre.';

COMMIT;
