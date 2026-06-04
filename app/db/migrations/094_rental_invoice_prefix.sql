-- 094_rental_invoice_prefix.sql
-- General-sale invoices to rental customers get RN/26-27/NNNN. All
-- other general sales keep GS/26-27/NNNN. The invoice's doc_type
-- column still reads 'general_sale' so existing filters / reports
-- continue to work unchanged.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('rental_invoice', 'RN', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true)
ON CONFLICT (doc_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_invoice_auto_no()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_rental boolean := false;
BEGIN
  IF NEW.invoice_no IS NULL OR length(trim(NEW.invoice_no)) = 0 THEN
    IF NEW.doc_type::text = 'general_sale' AND NEW.customer_id IS NOT NULL THEN
      SELECT EXISTS(
        SELECT 1
        FROM public.customer c
        JOIN public.ledger l       ON l.id = c.ledger_id
        JOIN public.ledger_type lt ON lt.id = l.type_id
        WHERE c.id = NEW.customer_id
          AND lt.name = 'RENTAL'
      ) INTO v_is_rental;
    END IF;

    NEW.invoice_no := fn_next_doc_no(
      CASE
        WHEN NEW.doc_type::text = 'tax_invoice'           THEN 'invoice'
        WHEN NEW.doc_type::text = 'general_sale' AND v_is_rental THEN 'rental_invoice'
        ELSE NEW.doc_type::text
      END
    );
  END IF;
  RETURN NEW;
END
$$;

COMMIT;
