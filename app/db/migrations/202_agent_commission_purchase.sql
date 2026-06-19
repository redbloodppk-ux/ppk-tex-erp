-- 202_agent_commission_purchase.sql
--
-- Extend agent_commission beyond fabric (tax) SALES invoices to PURCHASE
-- bills, keeping the commission a PAYABLE to the agent (party):
--   - yarn_lot purchases       -> commission per BAG or % of value
--   - fabric_purchase batches  -> commission per PC / per METRE / % of value
--
-- The commission still surfaces on the dashboard, is settled on Payments,
-- and is itemised in the agent's Ledger View exactly like the sales-side
-- commission. Each row points at EXACTLY ONE source document.

-- 1. invoice_id is no longer mandatory (purchase rows leave it NULL).
ALTER TABLE public.agent_commission
  ALTER COLUMN invoice_id DROP NOT NULL;

-- 2. New source links. Cascade-delete with the parent bill so deleting a
--    purchase takes its commission with it (mirrors invoice_id's cascade).
ALTER TABLE public.agent_commission
  ADD COLUMN IF NOT EXISTS yarn_lot_id        bigint REFERENCES public.yarn_lot(id)        ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS fabric_purchase_id bigint REFERENCES public.fabric_purchase(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_agent_commission_yarn ON public.agent_commission(yarn_lot_id);
CREATE INDEX IF NOT EXISTS idx_agent_commission_fab  ON public.agent_commission(fabric_purchase_id);

-- One commission per source document.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_commission_yarn
  ON public.agent_commission(yarn_lot_id)        WHERE yarn_lot_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_commission_fab
  ON public.agent_commission(fabric_purchase_id) WHERE fabric_purchase_id IS NOT NULL;

-- 3. Exactly one source set per row (sales invoice OR yarn OR fabric).
ALTER TABLE public.agent_commission
  DROP CONSTRAINT IF EXISTS agent_commission_one_source;
ALTER TABLE public.agent_commission
  ADD CONSTRAINT agent_commission_one_source CHECK (
    (invoice_id        IS NOT NULL)::int
  + (yarn_lot_id       IS NOT NULL)::int
  + (fabric_purchase_id IS NOT NULL)::int = 1
  );

-- 4. Allow the per-BAG commission type used by yarn purchases.
ALTER TABLE public.agent_commission
  DROP CONSTRAINT IF EXISTS agent_commission_commission_type_check;
ALTER TABLE public.agent_commission
  ADD CONSTRAINT agent_commission_commission_type_check
  CHECK (commission_type IN ('pcs','metre','percent','bag'));
