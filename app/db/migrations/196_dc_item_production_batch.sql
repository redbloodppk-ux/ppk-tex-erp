-- 196_dc_item_production_batch.sql
--
-- Adds a direct link from delivery_challan_item to production_batch so a
-- DC can dispatch fabric straight out of a production batch (skipping the
-- intermediate fabric_receipt step that the jobwork flow goes through).
--
-- When a DC item carries a production_batch_id, the save flow in
-- dc-form.tsx writes a corresponding stock_ledger outflow with
-- bucket='production_fabric' that depletes the inflow created by the
-- batch (source_kind='production_batch', source_id=batch.id).

ALTER TABLE public.delivery_challan_item
  ADD COLUMN IF NOT EXISTS production_batch_id bigint
    REFERENCES public.production_batch(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_dc_item_production_batch
  ON public.delivery_challan_item (production_batch_id);
