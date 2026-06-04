-- 092_resync_doc_sequence.sql
--
-- Adds a helper function fn_resync_doc_sequence(doc_type) that resets
-- doc_sequence.next_value to (MAX existing sequence number for that
-- doc_type) + 1. Useful whenever the counter drifts away from real
-- data (manual inserts, partial restores, dev/staging snapshots).
--
-- Also runs the resync once for every doc_type we know about. Safe to
-- re-run any time -- the function reads live data each call.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_resync_doc_sequence(p_doc_type text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_seq integer := 0;
  v_next    integer := 1;
BEGIN
  IF p_doc_type = 'jobwork_invoice' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_no, '.*/', ''), '')::int), 0)
      INTO v_max_seq
      FROM public.invoice
     WHERE doc_type = 'jobwork_invoice'
       AND invoice_no IS NOT NULL;
  ELSIF p_doc_type IN ('sales_invoice', 'gst_invoice', 'proforma', 'credit_note', 'debit_note') THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_no, '.*/', ''), '')::int), 0)
      INTO v_max_seq
      FROM public.invoice
     WHERE doc_type::text = p_doc_type
       AND invoice_no IS NOT NULL;
  ELSIF p_doc_type IN ('jobwork_dc', 'inhouse_dc') THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '.*/', ''), '')::int), 0)
      INTO v_max_seq
      FROM public.delivery_challan
     WHERE code IS NOT NULL
       AND (
         (p_doc_type = 'jobwork_dc' AND production_mode = 'jobwork')
         OR (p_doc_type = 'inhouse_dc' AND production_mode <> 'jobwork')
       );
  ELSIF p_doc_type = 'fabric_receipt' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, '.*/', ''), '')::int), 0)
      INTO v_max_seq
      FROM public.fabric_receipt
     WHERE code IS NOT NULL;
  ELSE
    RAISE NOTICE 'fn_resync_doc_sequence: unknown doc_type %, leaving next_value untouched', p_doc_type;
    RETURN -1;
  END IF;

  v_next := v_max_seq + 1;

  UPDATE public.doc_sequence
     SET next_value = v_next
   WHERE doc_type = p_doc_type;

  RETURN v_next;
END;
$$;

-- One-shot resync for the known doc types we ship. Each call sets
-- next_value = (max existing sequence) + 1 so the very next saved row
-- continues from where the live data left off.
SELECT public.fn_resync_doc_sequence('jobwork_invoice');
SELECT public.fn_resync_doc_sequence('jobwork_dc');
SELECT public.fn_resync_doc_sequence('inhouse_dc');
SELECT public.fn_resync_doc_sequence('fabric_receipt');

COMMIT;
