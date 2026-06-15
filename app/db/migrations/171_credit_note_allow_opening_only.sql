-- 171_credit_note_allow_opening_only.sql
--
-- invoice_return_check enforced that every credit_note row must
-- reference an original_invoice_id. That made sense when credit
-- notes could only adjust against current-system invoices. With
-- the new checkbox-driven picker, a credit note can also be issued
-- against opening receivables — balances brought forward from a
-- previous accounting system that don't exist as invoice rows here.
-- The constraint was blocking every such save:
--
--   ERROR: new row for relation "invoice" violates check constraint
--   "invoice_return_check"
--
-- Drop the strict check. The form-side flow still records the first
-- ticked invoice (when there is one) on original_invoice_id, so the
-- paper-trail link is preserved for invoice-based credits. For
-- opening-only credits, original_invoice_id is NULL and the
-- payment_opening_allocation rows carry the audit trail instead.

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_return_check;
