-- 051_yarn_lot_delivery_and_broker.sql
--
-- Yarn Stock form gains a delivery destination ("in-house" / "sizing")
-- and a broker dropdown that captures bag count + a snapshot of the
-- broker's per-bag rate. brokerage_amount is auto = bags * rate.

BEGIN;

-- 1) Delivery destination — rename legacy 'warehouse' value to 'in_house'.
ALTER TABLE public.yarn_lot ALTER COLUMN delivery_destination DROP DEFAULT;
ALTER TABLE public.yarn_lot DROP CONSTRAINT yarn_lot_delivery_destination_check;
UPDATE public.yarn_lot
   SET delivery_destination = 'in_house'
 WHERE delivery_destination = 'warehouse';
ALTER TABLE public.yarn_lot
  ADD CONSTRAINT yarn_lot_delivery_destination_check
  CHECK (delivery_destination IN ('in_house','sizing'));
ALTER TABLE public.yarn_lot ALTER COLUMN delivery_destination SET DEFAULT 'in_house';

-- 2) Broker is a vendor with vendor_type='broker'. Default per-bag rate
--    lives on the vendor row.
ALTER TABLE public.vendor
  ADD COLUMN IF NOT EXISTS brokerage_per_bag numeric(10,2);

COMMENT ON COLUMN public.vendor.brokerage_per_bag
  IS 'Default brokerage rate per bag for vendor_type=broker. Snapshotted on each yarn_lot purchase.';

-- 3) yarn_lot carries the broker reference + snapshot rate + bag count.
ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS broker_id          bigint REFERENCES public.vendor(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bag_count          integer NOT NULL DEFAULT 0 CHECK (bag_count >= 0),
  ADD COLUMN IF NOT EXISTS brokerage_per_bag  numeric(10,2) NOT NULL DEFAULT 0 CHECK (brokerage_per_bag >= 0);

ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS brokerage_amount numeric(14,2)
    GENERATED ALWAYS AS (ROUND(bag_count * brokerage_per_bag, 2)) STORED;

CREATE INDEX IF NOT EXISTS idx_yarn_lot_broker_id ON public.yarn_lot(broker_id);

COMMENT ON COLUMN public.yarn_lot.broker_id          IS 'FK to vendor where vendor_type=broker; nullable.';
COMMENT ON COLUMN public.yarn_lot.bag_count          IS 'Number of bags in this purchase batch.';
COMMENT ON COLUMN public.yarn_lot.brokerage_per_bag  IS 'Per-bag brokerage snapshot at purchase time.';
COMMENT ON COLUMN public.yarn_lot.brokerage_amount   IS 'Auto = bag_count * brokerage_per_bag.';

COMMIT;
