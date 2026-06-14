-- 170_fabric_purchase_payable.sql
--
-- Surfaces supplier-purchase fabric_purchase rows in the unified
-- Unpaid Bills picker (used by Payments, Fabric Stock customer-
-- adjustment mode, and Credit Note spread mode). They show up as
-- bills the mill owes its fabric supplier, exactly like
-- bobbin_purchase / yarn_lot / sizing_job.
--
-- Two kinds of fabric_purchase rows now exist:
--   - source='supplier' : we bought fabric from a Mill / Yarn
--     Supplier. We owe them the bill amount. It belongs in the
--     supplier's Unpaid Bills list and on the supplier's ledger as a
--     credit (Cr) until paid.
--   - source='customer' : a customer handed over fabric in lieu of
--     payment (covered by migration 168). A synthetic payment row
--     was created at that time, so this row is already accounted for
--     on the customer's ledger and SHOULD NOT show up as an unpaid
--     bill against them.
--
-- A) source column (text)
-- B) amount_paid (numeric) — running sum of allocations
-- C) payment_fabric_allocation table with the standard recalc trigger
-- D) Mirror trigger on payment for legacy direct fabric_purchase_id
--    rows (the migration-168 synthetic payments already use that
--    column, so their amount continues to bump amount_paid).
-- E) Backfill source on existing rows by checking whether a payment
--    already references them.

-- ── A) source column ─────────────────────────────────────────────
ALTER TABLE public.fabric_purchase
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'supplier'
    CHECK (source IN ('supplier', 'customer'));

-- ── B) amount_paid column ────────────────────────────────────────
ALTER TABLE public.fabric_purchase
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0);

-- ── E) Backfill ─ classify existing rows ─────────────────────────
-- Any fabric_purchase that already has a payment row pointing at it
-- (via payment.fabric_purchase_id) is a customer adjustment. All
-- others are supplier purchases. The backfill runs once; future
-- rows are tagged explicitly by the form.
UPDATE public.fabric_purchase fp
SET source = 'customer'
WHERE EXISTS (
  SELECT 1
  FROM   public.payment p
  WHERE  p.fabric_purchase_id = fp.id
);

-- Backfill amount_paid from existing synthetic payments (for
-- customer-mode rows) so the recalc triggers below start in sync.
UPDATE public.fabric_purchase fp
SET amount_paid = COALESCE((
  SELECT SUM(p.amount)
  FROM   public.payment p
  WHERE  p.fabric_purchase_id = fp.id
    AND  p.status::text NOT IN ('cancelled','void')
), 0);

-- ── C) Allocation table + recalc trigger ─────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_fabric_allocation (
  id                 bigserial PRIMARY KEY,
  payment_id         bigint NOT NULL REFERENCES public.payment(id) ON DELETE CASCADE,
  fabric_purchase_id bigint NOT NULL REFERENCES public.fabric_purchase(id) ON DELETE RESTRICT,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid
);
CREATE INDEX IF NOT EXISTS idx_pfa_pmt ON public.payment_fabric_allocation (payment_id);
CREATE INDEX IF NOT EXISTS idx_pfa_fp  ON public.payment_fabric_allocation (fabric_purchase_id);

CREATE OR REPLACE FUNCTION public.fn_pfa_recalc_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.fabric_purchase_id, OLD.fabric_purchase_id);
  UPDATE public.fabric_purchase fp
  SET amount_paid = COALESCE((
    SELECT SUM(a.amount)
    FROM   public.payment_fabric_allocation a
    WHERE  a.fabric_purchase_id = fp.id
  ), 0)
                  + COALESCE((
    SELECT SUM(p.amount)
    FROM   public.payment p
    WHERE  p.fabric_purchase_id = fp.id
      AND  p.status::text NOT IN ('cancelled','void')
  ), 0)
  WHERE fp.id = target_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_pfa_recalc_paid_ins ON public.payment_fabric_allocation;
CREATE TRIGGER trg_pfa_recalc_paid_ins AFTER INSERT ON public.payment_fabric_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pfa_recalc_paid();
DROP TRIGGER IF EXISTS trg_pfa_recalc_paid_upd ON public.payment_fabric_allocation;
CREATE TRIGGER trg_pfa_recalc_paid_upd AFTER UPDATE OF amount ON public.payment_fabric_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pfa_recalc_paid();
DROP TRIGGER IF EXISTS trg_pfa_recalc_paid_del ON public.payment_fabric_allocation;
CREATE TRIGGER trg_pfa_recalc_paid_del AFTER DELETE ON public.payment_fabric_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pfa_recalc_paid();

ALTER TABLE public.payment_fabric_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pfa_read  ON public.payment_fabric_allocation;
CREATE POLICY p_pfa_read  ON public.payment_fabric_allocation FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS p_pfa_write ON public.payment_fabric_allocation;
CREATE POLICY p_pfa_write ON public.payment_fabric_allocation FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- ── D) Mirror trigger on payment so legacy direct rows keep
--      amount_paid in sync. Same pattern as migration 166 (sizing).
CREATE OR REPLACE FUNCTION public.fn_payment_resync_fabric_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.fabric_purchase_id, OLD.fabric_purchase_id);
  IF target_id IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  UPDATE public.fabric_purchase fp
  SET amount_paid = COALESCE((
    SELECT SUM(a.amount)
    FROM   public.payment_fabric_allocation a
    WHERE  a.fabric_purchase_id = fp.id
  ), 0)
                  + COALESCE((
    SELECT SUM(p.amount)
    FROM   public.payment p
    WHERE  p.fabric_purchase_id = fp.id
      AND  p.status::text NOT IN ('cancelled','void')
  ), 0)
  WHERE fp.id = target_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_resync_fabric_ins ON public.payment;
CREATE TRIGGER trg_payment_resync_fabric_ins
  AFTER INSERT ON public.payment
  FOR EACH ROW
  WHEN (NEW.fabric_purchase_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_payment_resync_fabric_paid();

DROP TRIGGER IF EXISTS trg_payment_resync_fabric_upd ON public.payment;
CREATE TRIGGER trg_payment_resync_fabric_upd
  AFTER UPDATE ON public.payment
  FOR EACH ROW
  WHEN (NEW.fabric_purchase_id IS NOT NULL OR OLD.fabric_purchase_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_payment_resync_fabric_paid();

DROP TRIGGER IF EXISTS trg_payment_resync_fabric_del ON public.payment;
CREATE TRIGGER trg_payment_resync_fabric_del
  AFTER DELETE ON public.payment
  FOR EACH ROW
  WHEN (OLD.fabric_purchase_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_payment_resync_fabric_paid();
