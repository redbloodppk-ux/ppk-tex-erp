-- 075_jobwork_supplier_party.sql
--
-- Adds supplier_party_id to the three jobwork issue tables (warp_beam,
-- weft_bag, warp_yarn) so each restock can record which party supplied
-- the new batch. Bobbin already has vendor_id; we reuse it there.

BEGIN;

ALTER TABLE public.jobwork_warp_beam
  ADD COLUMN IF NOT EXISTS supplier_party_id bigint REFERENCES public.party(id) ON DELETE SET NULL;

ALTER TABLE public.jobwork_weft_bag
  ADD COLUMN IF NOT EXISTS supplier_party_id bigint REFERENCES public.party(id) ON DELETE SET NULL;

ALTER TABLE public.jobwork_warp_yarn
  ADD COLUMN IF NOT EXISTS supplier_party_id bigint REFERENCES public.party(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobwork_warp_beam_supplier ON public.jobwork_warp_beam(supplier_party_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_weft_bag_supplier  ON public.jobwork_weft_bag(supplier_party_id);
CREATE INDEX IF NOT EXISTS idx_jobwork_warp_yarn_supplier ON public.jobwork_warp_yarn(supplier_party_id);

COMMIT;
