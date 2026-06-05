-- 104_payment_mode_ledger.sql
--
-- Replace the free-text payment.mode dropdown (cash / cheque /
-- bank_transfer / upi / card / other) with a real FK to a BANK or
-- CASH ledger. Each payment now records WHICH cash drawer or bank
-- account the money came from / went to, which is what the
-- accountant actually wants for reconciliation.
--
-- The legacy `mode` text column stays in place and is auto-derived
-- ('cash' when the ledger is CASH-type, 'bank_transfer' otherwise) so
-- existing reports keep working without code changes.

BEGIN;

ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS mode_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_mode_ledger ON public.payment(mode_ledger_id);

COMMENT ON COLUMN public.payment.mode_ledger_id IS
  'FK to the BANK or CASH ledger that holds the money for this payment. Used by the unified /app/payments form. The legacy `mode` text column is auto-derived from the ledger type for back-compat.';

-- Auto-fill the legacy `mode` text column from the picked ledger's
-- type so old views / reports that read the text column keep working.
CREATE OR REPLACE FUNCTION public.fn_payment_derive_mode_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_type text;
BEGIN
  IF NEW.mode_ledger_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT lt.name INTO v_type
    FROM public.ledger l
    JOIN public.ledger_type lt ON lt.id = l.type_id
   WHERE l.id = NEW.mode_ledger_id;
  IF v_type = 'CASH' THEN
    NEW.mode := 'cash';
  ELSIF v_type = 'BANK' THEN
    NEW.mode := 'bank_transfer';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_payment_derive_mode_text ON public.payment;
CREATE TRIGGER trg_payment_derive_mode_text
  BEFORE INSERT OR UPDATE ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.fn_payment_derive_mode_text();

COMMIT;
