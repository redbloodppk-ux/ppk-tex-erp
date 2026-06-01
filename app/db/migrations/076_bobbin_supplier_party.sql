-- 076_bobbin_supplier_party.sql
--
-- Adds bobbin.supplier_party_id pointing at the unified party master so
-- the Bobbin Stock page can filter the supplier dropdown to parties
-- whose type = Bobbin Supplier. The legacy vendor_id (mill FK) stays
-- intact for backward compatibility with existing data.

BEGIN;

ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS supplier_party_id bigint REFERENCES public.party(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bobbin_supplier_party ON public.bobbin(supplier_party_id);

COMMENT ON COLUMN public.bobbin.supplier_party_id IS
  'Unified party FK for the supplier. The Bobbin Stock page filters this dropdown to party_type = Bobbin Supplier.';

COMMIT;
