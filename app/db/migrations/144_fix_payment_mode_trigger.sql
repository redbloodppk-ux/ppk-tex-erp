-- 144_fix_payment_mode_trigger.sql
--
-- The trigger fn_payment_derive_mode_text was setting NEW.mode :=
-- 'bank_transfer' when the picked ledger had type BANK, but the
-- payment_mode_check constraint (migration 143) only allows 'bank'.
-- The mismatch made the universal Payments page silently reject every
-- BANK-ledger payment. Align the trigger to the constraint by writing
-- 'bank' instead.

CREATE OR REPLACE FUNCTION public.fn_payment_derive_mode_text()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
    NEW.mode := 'bank';
  END IF;
  RETURN NEW;
END
$function$;
