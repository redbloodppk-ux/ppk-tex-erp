-- 143_payment_mode_allow_bank.sql
--
-- Allow 'bank' as a payment mode. The Job Work and Sizing payment
-- forms model 'bank' as a generic non-cash bucket (the operator
-- separately picks which bank ledger received the credit), so add it
-- to the allowed set alongside the more specific upi/neft/rtgs codes.

ALTER TABLE public.payment DROP CONSTRAINT IF EXISTS payment_mode_check;
ALTER TABLE public.payment ADD  CONSTRAINT payment_mode_check
  CHECK (mode = ANY (ARRAY[
    'cash'::text, 'bank'::text, 'upi'::text, 'neft'::text,
    'rtgs'::text, 'cheque'::text, 'card'::text, 'adjustment'::text
  ]));
