-- 084_jobwork_doc_types.sql
--
-- Splits jobwork docs onto their own number series:
--
--   Delivery Challan  inhouse   -> DC/26-27/NNNN     (unchanged)
--                     jobwork   -> JDC/26-27/NNNN    (new)
--
--   Invoice           tax_invoice / yarn_sale / etc.  (unchanged)
--                     jobwork_invoice -> JB/26-27/NNNN  (new)
--
-- Existing DCs and invoices keep their original codes. New prefixes
-- apply to rows inserted from this migration onwards.
--
-- The jobwork invoice files against a jobwork party (which lives in the
-- unified party master, not the legacy customer table) - so we add an
-- optional invoice.jobwork_party_id and reintroduce invoice_party_check
-- with a jobwork_invoice arm. The legacy vendor_id column was dropped
-- in migration 056 (replaced by ledger_id), so debit_note rows are no
-- longer party-checked at this level - their party is the ledger.
--
-- Run order: 084a must commit before 084b. Postgres lets you ALTER TYPE
-- ADD VALUE inside a transaction, but the new enum value cannot be USED
-- (e.g. compared in a CHECK constraint) until the txn commits.

-- ╭─────────────────────────────────────────────────────────────────╮
-- │ 084a - enum + doc_sequence rows (must run alone)                │
-- ╰─────────────────────────────────────────────────────────────────╯

ALTER TYPE invoice_doc_type ADD VALUE IF NOT EXISTS 'jobwork_invoice';

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES
  ('jobwork_dc',      'JDC', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true),
  ('jobwork_invoice', 'JB',  '{prefix}/{fy}/{seq:0000}', '26-27', 1, true)
ON CONFLICT (doc_type) DO NOTHING;

-- ╭─────────────────────────────────────────────────────────────────╮
-- │ 084b - trigger + invoice column + party check                   │
-- ╰─────────────────────────────────────────────────────────────────╯

CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE v_doc_type text;
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;
  v_doc_type := CASE TG_TABLE_NAME
    WHEN 'customer'           THEN 'cust'
    WHEN 'employee'           THEN 'emp'
    WHEN 'mill'               THEN 'mill'
    WHEN 'vendor'             THEN 'vendor'
    WHEN 'yarn_count'         THEN 'yc'
    WHEN 'ends_master'        THEN 'ends'
    WHEN 'fabric_quality'     THEN 'fq'
    WHEN 'bobbin'             THEN 'bobbin'
    WHEN 'ledger_type'        THEN 'ledger_type'
    WHEN 'ledger_group'       THEN 'ledger_group'
    WHEN 'ledger'             THEN 'ledger'
    WHEN 'fabric_type_master' THEN 'fabric_type'
    WHEN 'jobwork_party'      THEN 'jobwork_party'
    WHEN 'party_type_master'  THEN 'party_type'
    WHEN 'party'              THEN 'party'
    WHEN 'delivery_challan'   THEN
      CASE
        WHEN COALESCE(NEW.production_mode::text, 'inhouse') = 'jobwork'
          THEN 'jobwork_dc'
        ELSE 'dc'
      END
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $function$;

ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS jobwork_party_id bigint REFERENCES public.party(id);

CREATE INDEX IF NOT EXISTS idx_invoice_jobwork_party
  ON public.invoice(jobwork_party_id);

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_party_check;
ALTER TABLE public.invoice ADD CONSTRAINT invoice_party_check CHECK (
  (doc_type = 'jobwork_invoice'
     AND jobwork_party_id IS NOT NULL
     AND customer_id IS NULL)
  OR
  (doc_type <> 'jobwork_invoice'
     AND jobwork_party_id IS NULL)
);
