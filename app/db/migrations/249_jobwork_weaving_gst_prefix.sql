-- 249_jobwork_weaving_gst_prefix.sql
--
-- Job Work bills (JB) and Weaving Bills (WB) currently share one numbering
-- series each, regardless of whether GST is charged on them. The user wants
-- a separate series that kicks in the moment GST is filled on the bill:
--
--   jobwork_invoice, no GST  -> unchanged series, prefix JB  (continues at
--                                whatever it's currently at, e.g. JB/26-27/0008)
--   jobwork_invoice, GST > 0 -> new series,       prefix JWB, starts at JWB/26-27/0001
--   weaving_bill,    no GST  -> unchanged series, prefix WB
--   weaving_bill,    GST > 0 -> new series,       prefix WGB, starts at WGB/26-27/0001
--
-- No new column is needed: invoice.gst_amount is already populated by the
-- client at insert time (round2(cgst+sgst+igst)), so the trigger can just
-- check NEW.gst_amount > 0. This follows the same pattern as the existing
-- rental_invoice split in fn_invoice_auto_no() (094_rental_invoice_prefix.sql):
-- same invoice.doc_type, different doc_sequence key chosen by a live condition.

-- 1. Register the two new GST series. ON CONFLICT DO NOTHING so this
--    migration is safe to re-run.
INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES
  ('jobwork_invoice_gst', 'JWB', '{prefix}/{fy}/{seq:0000}', fn_fy_code(CURRENT_DATE), 1, true),
  ('weaving_bill_gst',    'WGB', '{prefix}/{fy}/{seq:0000}', fn_fy_code(CURRENT_DATE), 1, true)
ON CONFLICT (doc_type) DO NOTHING;

-- 2. Teach fn_invoice_auto_no() to route jobwork_invoice / weaving_bill rows
--    to the *_gst series whenever gst_amount is filled, otherwise keep them
--    on the original series.
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
        WHEN NEW.doc_type::text = 'tax_invoice'                                                  THEN 'invoice'
        WHEN NEW.doc_type::text = 'general_sale' AND v_is_rental                                  THEN 'rental_invoice'
        WHEN NEW.doc_type::text = 'jobwork_invoice' AND COALESCE(NEW.gst_amount, 0) > 0           THEN 'jobwork_invoice_gst'
        WHEN NEW.doc_type::text = 'weaving_bill'    AND COALESCE(NEW.gst_amount, 0) > 0           THEN 'weaving_bill_gst'
        WHEN NEW.doc_type::text = 'weaving_bill'                                                  THEN 'weaving_bill'
        ELSE NEW.doc_type::text
      END
    );
  END IF;
  RETURN NEW;
END
$$;
