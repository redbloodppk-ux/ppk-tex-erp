-- 195_production_batch_dc_bundles.sql
--
-- Adds a "Batch DC" capture surface to production_batch that mirrors the
-- delivery_challan_item bundle/piece UX. Operators can record produced
-- fabric as either:
--   * summary   — flat totals (bundles / pieces / metres) typed directly
--   * detailed  — per-bundle piece-by-piece metre entry, summed back into
--                 the existing produced_m column
--
-- The legacy produced_m column stays the source of truth for everything
-- downstream (stock_ledger writes, cost snapshots, dashboards). The new
-- columns are additive metadata so the print/edit screens can rehydrate
-- the bundle grid.

ALTER TABLE public.production_batch
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'summary'
    CHECK (entry_mode IN ('summary', 'detailed')),
  ADD COLUMN IF NOT EXISTS total_pieces integer,
  ADD COLUMN IF NOT EXISTS total_bundles integer,
  ADD COLUMN IF NOT EXISTS bundles_detail jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.production_batch.bundles_detail IS
  'Bundle-level breakdown: same shape as delivery_challan_item.bundles_detail. Empty array when entry_mode=summary.';
