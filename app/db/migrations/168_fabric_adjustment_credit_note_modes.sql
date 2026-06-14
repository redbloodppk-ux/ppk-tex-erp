-- 168_fabric_adjustment_credit_note_modes.sql
--
-- Two new flows surface in the unified Payments + Allocations
-- machinery:
--   - Fabric Stock customer-adjustment: a customer hands over fabric
--     in lieu of cash. The fabric_purchase row is the inventory side;
--     a synthetic payment row records the money side so the customer's
--     unpaid bills can auto-settle.
--   - Credit Note (sales return) spread mode: a credit note can now
--     allocate across multiple unpaid bills instead of always the
--     original invoice. The money side, again, is a synthetic payment.
--
-- payment.mode is a text column with no CHECK constraint today, so the
-- new values 'fabric_adjustment' and 'credit_note' don't need a schema
-- migration to be accepted. We document them on the column so the
-- enum is honest.

COMMENT ON COLUMN public.payment.mode IS
  'cash | bank_transfer | upi | cheque | fabric_adjustment | credit_note';

-- Audit link from each synthetic adjustment payment back to its
-- fabric_purchase row. ON DELETE CASCADE because if the operator
-- decides the fabric row was wrong and deletes it, the synthetic
-- money side must go too.
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS fabric_purchase_id bigint
    REFERENCES public.fabric_purchase(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_payment_fabric_purchase_id
  ON public.payment (fabric_purchase_id) WHERE fabric_purchase_id IS NOT NULL;
