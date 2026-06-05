-- 102_payment_table.sql
--
-- Unified `payment` table for every money movement against any party —
-- customer, supplier, sizing vendor, weaving vendor, bobbin supplier,
-- broker, jobwork party. Direction tells you which side:
--   'in'  → cash / cheque / transfer received  (customer pays us, etc.)
--   'out' → cash / cheque / transfer paid out (we pay a supplier, etc.)
--
-- The new unified /app/payments page replaces the old /app/pay-customer
-- and /app/pay-purchase stubs.
--
-- The base table existed in seed.sql with separate customer_id /
-- mill_id / ledger_id FKs. This migration adds the unified party_id
-- column, backfills it from the legacy FKs, and wires the auto-no /
-- updated_at triggers. The legacy columns stay in place for
-- back-compat with any old data that may already be present.

BEGIN;

-- 1. doc_sequence for PAY/26-27/NNNN.
INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('payment', 'PAY', '{prefix}/{fy}/{seq:0000}', 1, '26-27')
ON CONFLICT (doc_type) DO NOTHING;

-- 2. payment_mode enum (payment_direction already exists in earlier seed).
DO $$ BEGIN
  CREATE TYPE payment_mode AS ENUM ('cash', 'cheque', 'bank_transfer', 'upi', 'card', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Ensure the table exists. If it does (from seed.sql) we just add
--    the new columns; if it doesn't, we create it with the canonical
--    shape used by the new /app/payments page.
CREATE TABLE IF NOT EXISTS public.payment (
  id            bigserial PRIMARY KEY,
  payment_no    text NOT NULL UNIQUE,
  payment_date  date NOT NULL DEFAULT CURRENT_DATE,
  direction     public.payment_direction NOT NULL,
  amount        numeric(14,2) NOT NULL,
  mode          text NOT NULL DEFAULT 'bank_transfer',
  reference     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);

-- 4. Make sure every column the unified page expects is present.
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS party_id   bigint REFERENCES public.party(id) ON DELETE RESTRICT;
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS invoice_id bigint REFERENCES public.invoice(id) ON DELETE SET NULL;
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS status     public.record_status NOT NULL DEFAULT 'active';
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- 5. Backfill party_id from the legacy customer_id / ledger_id columns
--    if they exist on this install (no-op on fresh installs).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payment' AND column_name='customer_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.payment p
         SET party_id = pt.id
        FROM public.customer c
        JOIN public.party pt ON pt.ledger_id = c.ledger_id
       WHERE p.customer_id IS NOT NULL
         AND p.customer_id = c.id
         AND p.party_id IS NULL
    $sql$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='payment' AND column_name='ledger_id'
  ) THEN
    EXECUTE $sql$
      UPDATE public.payment p
         SET party_id = pt.id
        FROM public.party pt
       WHERE p.ledger_id IS NOT NULL
         AND pt.ledger_id = p.ledger_id
         AND p.party_id IS NULL
    $sql$;
  END IF;
END $$;

-- 6. Indexes.
CREATE INDEX IF NOT EXISTS idx_payment_party     ON public.payment(party_id);
CREATE INDEX IF NOT EXISTS idx_payment_date      ON public.payment(payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_direction ON public.payment(direction);
CREATE INDEX IF NOT EXISTS idx_payment_invoice   ON public.payment(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_status    ON public.payment(status);

-- 7. Auto payment_no trigger.
CREATE OR REPLACE FUNCTION public.fn_payment_auto_no()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_no IS NOT NULL AND NEW.payment_no <> '' THEN
    RETURN NEW;
  END IF;
  NEW.payment_no := public.fn_next_doc_no('payment');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_payment_auto_no ON public.payment;
CREATE TRIGGER trg_payment_auto_no
  BEFORE INSERT ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_auto_no();

-- 8. updated_at trigger.
CREATE OR REPLACE FUNCTION public.fn_payment_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_payment_touch_updated_at ON public.payment;
CREATE TRIGGER trg_payment_touch_updated_at
  BEFORE UPDATE ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_touch_updated_at();

-- 9. RLS — open access for now (matches other modules).
ALTER TABLE public.payment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_payment_select ON public.payment;
CREATE POLICY p_payment_select ON public.payment FOR SELECT USING (true);
DROP POLICY IF EXISTS p_payment_modify ON public.payment;
CREATE POLICY p_payment_modify ON public.payment FOR ALL USING (true) WITH CHECK (true);

COMMIT;
