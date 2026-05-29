-- 054_ledger_brokerage_per_bag.sql
--
-- Brokers are now AGENT-type ledgers. The default per-bag rate moves
-- from vendor.brokerage_per_bag to ledger.brokerage_per_bag so the
-- Yarn Stock broker dropdown can pre-fill from the ledger master.

BEGIN;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS brokerage_per_bag numeric(10,2);

COMMENT ON COLUMN public.ledger.brokerage_per_bag
  IS 'Default brokerage rate per bag for AGENT-type ledgers. Snapshotted on each yarn_lot purchase.';

UPDATE public.ledger l
SET    brokerage_per_bag = v.brokerage_per_bag
FROM   public.vendor v
WHERE  v.name = l.name
  AND  v.brokerage_per_bag IS NOT NULL
  AND  l.brokerage_per_bag IS NULL;

COMMIT;
