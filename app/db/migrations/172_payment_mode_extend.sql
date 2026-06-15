-- 172_payment_mode_extend.sql
--
-- payment_mode_check today restricts payment.mode to the original
-- 8 values: cash, bank, upi, neft, rtgs, cheque, card, adjustment.
-- Migration 168 added the synthetic 'credit_note' and
-- 'fabric_adjustment' modes for the unified Payments + Allocations
-- machinery, but only updated the column COMMENT — the CHECK
-- constraint was never extended. So saving a credit note triggered:
--
--   new row for relation "payment" violates check constraint
--   "payment_mode_check"
--
-- Drop and re-create the check with the two new modes included.

ALTER TABLE public.payment DROP CONSTRAINT IF EXISTS payment_mode_check;

ALTER TABLE public.payment
  ADD CONSTRAINT payment_mode_check
  CHECK (mode = ANY (ARRAY[
    'cash', 'bank', 'upi', 'neft', 'rtgs', 'cheque', 'card',
    'adjustment',
    'fabric_adjustment',
    'credit_note'
  ]::text[]));

COMMENT ON COLUMN public.payment.mode IS
  'cash | bank | upi | neft | rtgs | cheque | card | adjustment '
  '| fabric_adjustment | credit_note';
