-- 126_resync_dc_sequences.sql
--
-- The Delivery Challan auto-numbering trigger (fn_autogen_code, mig 123)
-- routes inhouse → 'dc', jobwork → 'jobwork_dc', outsource →
-- 'outsource_dc'. But the resync helper from migration 092
-- (fn_resync_doc_sequence) only knew about 'jobwork_dc' and a typo
-- 'inhouse_dc' — neither of which matches the in-house or outsource
-- rows in doc_sequence. So a stale or reset 'dc' counter (the actual
-- in-house DC doc_type) was never being corrected by the helper, and
-- new in-house DCs were restarting at DC/26-27/0001 even when later
-- numbers already existed.
--
-- This migration:
--   1. Teaches fn_resync_doc_sequence about the real doc_types ('dc'
--      and 'outsource_dc'), restricts the regex to codes matching the
--      doc_sequence row's prefix + fy_code so old-format codes (or
--      codes from a different production_mode that share the
--      delivery_challan table) don't pollute the max.
--   2. Removes the typo branch 'inhouse_dc'.
--   3. Runs the resync once for all three DC kinds. After this commit
--      every in-house, jobwork and outsource DC sequence sits at
--      (highest matching code's sequence number) + 1.
--
-- Re-runnable safely. The function reads live data every call.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_resync_doc_sequence(p_doc_type text)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_max_seq    integer := 0;
  v_next       integer := 1;
  v_prefix     text;
  v_fy_code    text;
  v_code_pat   text;          -- e.g. '^DC/26-27/[0-9]+$' for the regex match
  v_seq_pat    text;          -- pattern that captures just the trailing seq
BEGIN
  -- Pull the prefix + fy_code so we only consider codes that this
  -- doc_sequence row actually produced. Without this filter a row with
  -- a hand-typed legacy code (e.g. "OLD-DC-12") could yank the max
  -- value into a wrong bucket.
  SELECT prefix, fy_code
    INTO v_prefix, v_fy_code
    FROM public.doc_sequence
   WHERE doc_type = p_doc_type;
  IF v_prefix IS NULL THEN
    RAISE NOTICE 'fn_resync_doc_sequence: no doc_sequence row for %, skipping', p_doc_type;
    RETURN -1;
  END IF;

  -- Match codes shaped exactly like "<PREFIX>/<FY>/<DIGITS>". We extract
  -- the trailing digits with the same regex so old codes that don't fit
  -- this shape get filtered out cleanly.
  v_code_pat := '^' || v_prefix || '/' || v_fy_code || '/[0-9]+$';
  v_seq_pat  := v_prefix || '/' || v_fy_code || '/';

  IF p_doc_type = 'jobwork_invoice' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_no, v_seq_pat, ''), '')::int), 0)
      INTO v_max_seq
      FROM public.invoice
     WHERE doc_type = 'jobwork_invoice'
       AND invoice_no ~ v_code_pat;

  ELSIF p_doc_type IN ('sales_invoice', 'gst_invoice', 'proforma', 'credit_note', 'debit_note') THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(invoice_no, v_seq_pat, ''), '')::int), 0)
      INTO v_max_seq
      FROM public.invoice
     WHERE doc_type::text = p_doc_type
       AND invoice_no ~ v_code_pat;

  ELSIF p_doc_type IN ('dc', 'jobwork_dc', 'outsource_dc') THEN
    -- For DCs we ALSO restrict on production_mode so the three series
    -- don't poach each other's max when reset_yearly hasn't fired and
    -- numbers overlap. Map doc_type → production_mode:
    --   'dc'           → 'inhouse' (or NULL / 'inhouse' default)
    --   'jobwork_dc'   → 'jobwork'
    --   'outsource_dc' → 'outsource'
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, v_seq_pat, ''), '')::int), 0)
      INTO v_max_seq
      FROM public.delivery_challan
     WHERE code IS NOT NULL
       AND code ~ v_code_pat
       AND (
         (p_doc_type = 'dc'           AND COALESCE(production_mode, 'inhouse') = 'inhouse')
         OR (p_doc_type = 'jobwork_dc'   AND production_mode = 'jobwork')
         OR (p_doc_type = 'outsource_dc' AND production_mode = 'outsource')
       );

  ELSIF p_doc_type = 'fabric_receipt' THEN
    SELECT COALESCE(MAX(NULLIF(regexp_replace(code, v_seq_pat, ''), '')::int), 0)
      INTO v_max_seq
      FROM public.fabric_receipt
     WHERE code IS NOT NULL
       AND code ~ v_code_pat;

  ELSE
    RAISE NOTICE 'fn_resync_doc_sequence: unknown doc_type %, leaving next_value untouched', p_doc_type;
    RETURN -1;
  END IF;

  v_next := v_max_seq + 1;

  UPDATE public.doc_sequence
     SET next_value = v_next
   WHERE doc_type = p_doc_type;

  RAISE NOTICE 'fn_resync_doc_sequence(%): max=%, next_value→%', p_doc_type, v_max_seq, v_next;
  RETURN v_next;
END;
$$;

-- One-shot resync for every doc_type we care about. Safe to re-run.
SELECT public.fn_resync_doc_sequence('dc');
SELECT public.fn_resync_doc_sequence('jobwork_dc');
SELECT public.fn_resync_doc_sequence('outsource_dc');
SELECT public.fn_resync_doc_sequence('jobwork_invoice');
SELECT public.fn_resync_doc_sequence('fabric_receipt');

COMMIT;
