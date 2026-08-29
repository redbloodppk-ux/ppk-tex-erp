-- 272_tds_payment.sql
--
-- Records TDS remitted to the government, so a monthly liability can be
-- marked settled and stop accruing interest.
--
-- WHY A TABLE AND NOT A DERIVED FIGURE
-- The liability itself IS derived - lib/tds/liability.ts groups the bills
-- by deduction month and computes the due date and interest. Only the
-- REMITTANCE is a fact that cannot be inferred from anything else: the
-- government portal is outside this system, so nothing here knows a
-- challan was paid unless somebody records it.
--
-- One row per payment, not per month, so a part payment is expressible
-- and the liability arithmetic stays honest about the remainder.
--
-- period_month is the month the tax was DEDUCTED in, which is what the
-- challan is filed against - not the month the payment was made. Paying
-- April's TDS in September is one row: period_month 2026-04, paid_date in
-- September. Storing the payment date as the period would lose the link
-- to the bills entirely.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tds_payment (
  id               bigserial PRIMARY KEY,
  -- YYYY-MM of DEDUCTION. Text rather than a date because that is exactly
  -- what it is - a month, not a day - and matching lib/tds/liability.ts
  -- avoids a conversion that could drift at a month boundary.
  period_month     text NOT NULL CHECK (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  -- Split out so the interest paid is visible separately from the tax.
  interest_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (interest_amount >= 0),
  paid_date        date NOT NULL,
  -- Challan / BSR reference from the portal receipt.
  challan_no       text,
  -- Which cash or bank account it went out of, mirroring wage_entry.
  source_ledger_id bigint REFERENCES public.ledger(id),
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid
);

CREATE INDEX IF NOT EXISTS idx_tds_payment_period ON public.tds_payment(period_month);
CREATE INDEX IF NOT EXISTS idx_tds_payment_paid_date ON public.tds_payment(paid_date);

COMMENT ON TABLE public.tds_payment IS
  'TDS remitted to the government. period_month is the month the tax was '
  'DEDUCTED (what the challan is filed against), not the month it was '
  'paid. The liability itself is derived in lib/tds/liability.ts; only '
  'the remittance is stored. See migration 272.';

CREATE OR REPLACE FUNCTION public.fn_tds_payment_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$$;

DROP TRIGGER IF EXISTS trg_tds_payment_touch ON public.tds_payment;
CREATE TRIGGER trg_tds_payment_touch
  BEFORE UPDATE ON public.tds_payment
  FOR EACH ROW EXECUTE FUNCTION public.fn_tds_payment_touch_updated_at();

ALTER TABLE public.tds_payment ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_tds_payment_read ON public.tds_payment;
CREATE POLICY p_tds_payment_read ON public.tds_payment
  FOR SELECT USING (
    public.current_user_role() = ANY (ARRAY[
      'owner'::user_role, 'auditor'::user_role, 'accounts'::user_role
    ])
  );

DROP POLICY IF EXISTS p_tds_payment_write ON public.tds_payment;
CREATE POLICY p_tds_payment_write ON public.tds_payment
  FOR ALL USING (
    public.current_user_role() = ANY (ARRAY['owner'::user_role, 'accounts'::user_role])
  );

COMMIT;
