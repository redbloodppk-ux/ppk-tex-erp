-- 162_party_opening_ledger_paid.sql
--
-- party_opening_ledger gains an amount_paid column so the row can be
-- partially settled by payments. The balance (= amount - amount_paid)
-- is generated so client code never has to recompute it. The Payments
-- form will list these rows alongside live invoices under "Unpaid
-- bills" and write into payment_opening_allocation (separate table
-- so payment_allocation's invoice_id FK stays valid for live invoices).

ALTER TABLE public.party_opening_ledger
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0);

-- Generated balance column. Saves the front-end from doing the math
-- and lets us index/order on it directly.
ALTER TABLE public.party_opening_ledger
  ADD COLUMN IF NOT EXISTS balance numeric(14,2)
    GENERATED ALWAYS AS (amount - amount_paid) STORED;

-- Allocation table — one row per (payment, opening_ledger_entry) pair.
-- We keep this separate from payment_allocation (which carries
-- invoice_id) so neither table grows a polymorphic FK.
CREATE TABLE IF NOT EXISTS public.payment_opening_allocation (
  id                 bigserial PRIMARY KEY,
  payment_id         bigint NOT NULL REFERENCES public.payment(id) ON DELETE CASCADE,
  opening_ledger_id  bigint NOT NULL REFERENCES public.party_opening_ledger(id) ON DELETE RESTRICT,
  amount             numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid
);

CREATE INDEX IF NOT EXISTS idx_pol_alloc_pmt ON public.payment_opening_allocation (payment_id);
CREATE INDEX IF NOT EXISTS idx_pol_alloc_opl ON public.payment_opening_allocation (opening_ledger_id);

-- Keep amount_paid in sync with the sum of allocations against this
-- opening_ledger row.
CREATE OR REPLACE FUNCTION public.fn_pol_recalc_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.opening_ledger_id, OLD.opening_ledger_id);
  UPDATE public.party_opening_ledger pol
  SET amount_paid = COALESCE((
    SELECT SUM(a.amount)
    FROM public.payment_opening_allocation a
    WHERE a.opening_ledger_id = pol.id
  ), 0)
  WHERE pol.id = target_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pol_recalc_paid_ins ON public.payment_opening_allocation;
CREATE TRIGGER trg_pol_recalc_paid_ins
  AFTER INSERT ON public.payment_opening_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pol_recalc_paid();

DROP TRIGGER IF EXISTS trg_pol_recalc_paid_upd ON public.payment_opening_allocation;
CREATE TRIGGER trg_pol_recalc_paid_upd
  AFTER UPDATE OF amount ON public.payment_opening_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pol_recalc_paid();

DROP TRIGGER IF EXISTS trg_pol_recalc_paid_del ON public.payment_opening_allocation;
CREATE TRIGGER trg_pol_recalc_paid_del
  AFTER DELETE ON public.payment_opening_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pol_recalc_paid();

ALTER TABLE public.payment_opening_allocation ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_poa_read ON public.payment_opening_allocation;
CREATE POLICY p_poa_read ON public.payment_opening_allocation FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS p_poa_write ON public.payment_opening_allocation;
CREATE POLICY p_poa_write ON public.payment_opening_allocation FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
