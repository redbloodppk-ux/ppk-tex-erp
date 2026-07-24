-- 244_credit_note_mark_spent.sql
-- Every credit_note invoice auto-creates a synthetic "payment" (mode =
-- 'credit_note') representing its value being spent against a bill or an
-- opening-ledger balance (see app/app/app/invoices/new/page.tsx). But
-- nothing ever fed back into the credit note's own amount_paid/status, so
-- a credit note stayed 'issued' with its full balance forever even after
-- being fully spent -- meaning its value got counted as an ACTIVE discount
-- against the customer's outstanding total every day, on top of already
-- having reduced whatever bill/opening balance it was spent on. This
-- double-counting was flagged by S R TEX's CN/26-27/0005 (Rs 2,103): the
-- credit was spent settling opening-ledger balance id=6 (now correctly
-- Rs 0), but the credit note itself never updated, so it kept subtracting
-- another Rs 2,103 from today's outstanding on top of that. The user had
-- manually patched this with a Rs 2,103 opening-ledger entry (id=43) to
-- cancel out the phantom reduction -- confirming the bug rather than
-- reflecting a real historical balance.
--
-- A full scan found this bug is NOT limited to S R TEX: all 10 credit
-- notes issued so far have been fully (or, in one case, almost fully)
-- spent via this mechanism, affecting 7 customers total (PRADEEP EXPORT,
-- SHREE JAGANNATH TEXTILES, SHRI GIRIRAJ TEXTILES, SANJAY ENTERPRISES,
-- S R TEX, NIRMAL & CO, G T M FABRICS, JETHIYA GLOBAL), none of whom
-- (other than S R TEX) had a compensating opening entry -- so their real
-- outstanding was understated by the credit note's amount without anyone
-- patching it.
--
-- Fix: mirror the existing "mark paid once allocated" pattern already
-- used for regular invoices (fn_payment_allocation_sync_invoice) but keyed
-- off payment.invoice_id (the SOURCE credit note a synthetic payment was
-- generated from) instead of payment_allocation.invoice_id (the TARGET
-- bill being paid down). amount_paid on the credit note becomes the sum of
-- everything its synthetic payment(s) allocated away (to other invoices
-- via payment_allocation, or to opening-ledger rows via
-- payment_opening_allocation); status flips to partial_paid/paid the same
-- way regular invoices do. Once a credit note's status is 'paid', it's
-- automatically excluded from v_customer_outstanding, the party statement
-- print page, and the dashboard widget -- all of which already filter out
-- paid/cancelled invoices -- so no view changes are needed.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_credit_note_recalc_spent(p_invoice_id bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_spent NUMERIC;
  v_total NUMERIC;
  v_doc_type TEXT;
BEGIN
  IF p_invoice_id IS NULL THEN RETURN; END IF;

  SELECT doc_type::text, total INTO v_doc_type, v_total
  FROM public.invoice WHERE id = p_invoice_id;

  IF v_doc_type IS DISTINCT FROM 'credit_note' THEN RETURN; END IF;

  SELECT COALESCE(SUM(amt), 0) INTO v_spent
  FROM (
    SELECT pa.amount AS amt
    FROM public.payment_allocation pa
    JOIN public.payment p ON p.id = pa.payment_id
    WHERE p.invoice_id = p_invoice_id AND p.status = 'active'
    UNION ALL
    SELECT poa.amount AS amt
    FROM public.payment_opening_allocation poa
    JOIN public.payment p ON p.id = poa.payment_id
    WHERE p.invoice_id = p_invoice_id AND p.status = 'active'
  ) spent_rows;

  UPDATE public.invoice
     SET amount_paid = v_spent,
         status = CASE
           WHEN status = 'cancelled' THEN status
           WHEN v_spent >= v_total AND v_total > 0 THEN 'paid'::invoice_status
           WHEN v_spent > 0 THEN 'partial_paid'::invoice_status
           ELSE 'issued'::invoice_status
         END
   WHERE id = p_invoice_id;
END;
$$;

-- payment_allocation changes (credit note spent against another invoice/bill)
CREATE OR REPLACE FUNCTION public.fn_trg_credit_note_recalc_from_pa()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_credit_note_recalc_spent(
    (SELECT invoice_id FROM public.payment WHERE id = COALESCE(NEW.payment_id, OLD.payment_id))
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_note_recalc_from_pa ON public.payment_allocation;
CREATE TRIGGER trg_credit_note_recalc_from_pa
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_credit_note_recalc_from_pa();

-- payment_opening_allocation changes (credit note spent against an opening-ledger balance)
CREATE OR REPLACE FUNCTION public.fn_trg_credit_note_recalc_from_poa()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_credit_note_recalc_spent(
    (SELECT invoice_id FROM public.payment WHERE id = COALESCE(NEW.payment_id, OLD.payment_id))
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_note_recalc_from_poa ON public.payment_opening_allocation;
CREATE TRIGGER trg_credit_note_recalc_from_poa
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_opening_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_credit_note_recalc_from_poa();

-- payment-level changes (e.g. the synthetic payment gets cancelled, or its
-- invoice_id is edited) also need to resync the credit note it points to.
CREATE OR REPLACE FUNCTION public.fn_trg_credit_note_recalc_from_payment()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_credit_note_recalc_spent(NEW.invoice_id);
  IF TG_OP = 'UPDATE' AND OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    PERFORM public.fn_credit_note_recalc_spent(OLD.invoice_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_credit_note_recalc_from_payment ON public.payment;
CREATE TRIGGER trg_credit_note_recalc_from_payment
  AFTER UPDATE ON public.payment
  FOR EACH ROW EXECUTE FUNCTION public.fn_trg_credit_note_recalc_from_payment();

-- Backfill: resync every existing credit note against its current
-- allocations so already-spent credit notes are marked paid/partial_paid
-- immediately, without waiting for their allocations to change again.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.invoice WHERE doc_type = 'credit_note' LOOP
    PERFORM public.fn_credit_note_recalc_spent(r.id);
  END LOOP;
END;
$$;

COMMIT;
