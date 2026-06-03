-- 089_fabric_quality_merged_delivery.sql
--
-- Merged-delivery flag on fabric_quality.
--
-- Some fabric qualities are functionally identical for inventory - sold
-- under different codes but woven from the same warp beams. Operators
-- want to treat those as a single stock pool during Fabric Receipt.
--
-- is_merged   - flag this fabric quality as part of a merged pool.
-- merged_name - the pool's common display name (e.g. "Thalapathi 30").
--               All fabric_quality rows sharing this name (and with
--               is_merged=true) belong to one pool.
--
-- During Fabric Receipt, the Stock card and the FIFO reductions for
-- warp / weft / porvai look at this pool, not just the single quality.

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS is_merged   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS merged_name text;

CREATE INDEX IF NOT EXISTS idx_fq_merged_name
  ON public.fabric_quality(merged_name)
  WHERE is_merged = true AND merged_name IS NOT NULL;

COMMENT ON COLUMN public.fabric_quality.is_merged IS
  'True = treat all fabric_quality rows sharing merged_name as one stock pool for warp/weft/bobbin during fabric receipt.';
COMMENT ON COLUMN public.fabric_quality.merged_name IS
  'Common fabric name. Rows with is_merged=true and the same merged_name share their warp/weft/bobbin stock.';
