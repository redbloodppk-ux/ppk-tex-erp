-- 115b_weaving_bill_constraints.sql
--
-- Companion to 115. Updates the invoice_party_check constraint and the
-- fn_invoice_auto_no trigger so the new 'weaving_bill' doc_type is
-- supported alongside 'jobwork_invoice'. Both file against a jobwork
-- party (kind discriminates jobwork vs outsource on the party itself).
--
-- Must run in a separate transaction from 115 because that migration
-- added the enum value 'weaving_bill' — Postgres won't let us USE it in
-- a CHECK constraint or trigger body until 115 has committed.

BEGIN;

ALTER TABLE public.invoice DROP CONSTRAINT IF EXISTS invoice_party_check;
ALTER TABLE public.invoice ADD CONSTRAINT invoice_party_check CHECK (
  (doc_type IN ('jobwork_invoice', 'weaving_bill')
     AND jobwork_party_id IS NOT NULL
     AND customer_id IS NULL)
  OR
  (doc_type NOT IN ('jobwork_invoice', 'weaving_bill')
     AND jobwork_party_id IS NULL)
);

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
        WHEN NEW.doc_type::text = 'tax_invoice'                  THEN 'invoice'
        WHEN NEW.doc_type::text = 'general_sale' AND v_is_rental THEN 'rental_invoice'
        WHEN NEW.doc_type::text = 'weaving_bill'                 THEN 'weaving_bill'
        ELSE NEW.doc_type::text
      END
    );
  END IF;
  RETURN NEW;
END
$$;

COMMIT;
