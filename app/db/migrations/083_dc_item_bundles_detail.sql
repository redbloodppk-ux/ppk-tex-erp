-- 083_dc_item_bundles_detail.sql
--
-- DC line items go from "metres / pieces / bundles + rate / amount" to a
-- hierarchical bundle-and-pieces breakdown:
--
--   Item (fabric quality, hsn)
--     Bundle #1
--       Piece 1: 5.2 m
--       Piece 2: 6.1 m
--     Bundle #2
--       Piece 1: 5.0 m
--       ...
--
-- The user types each piece's metres into the bundle it belongs to. The
-- metres / pieces / bundles columns on delivery_challan_item are now
-- snapshot aggregates of the JSON below. Rate / amount are gone - a DC
-- is a delivery document, not an invoice.

BEGIN;

ALTER TABLE public.delivery_challan_item DROP COLUMN IF EXISTS rate_per_m;
ALTER TABLE public.delivery_challan_item DROP COLUMN IF EXISTS amount;

ALTER TABLE public.delivery_challan_item
  ADD COLUMN IF NOT EXISTS bundles_detail jsonb;

COMMENT ON COLUMN public.delivery_challan_item.bundles_detail IS
  'Hierarchical bundle -> piece breakdown entered by the operator. metres / pieces / bundles on this row are snapshot aggregates of this JSON.';

COMMIT;
