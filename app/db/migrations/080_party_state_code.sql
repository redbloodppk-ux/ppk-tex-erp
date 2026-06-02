-- 080_party_state_code.sql
--
-- Adds state_code (text) to party / customer / mill so each row can
-- record the GST state code (first 2 digits of the GSTIN, e.g. "33" for
-- Tamil Nadu). The party forms auto-fill this field from the GSTIN
-- lookup response. Useful for IGST vs CGST/SGST detection on invoices
-- when the seller and buyer state codes differ.
--
-- Existing rows with a valid 15-char GSTIN are backfilled by slicing
-- LEFT(gstin, 2). Rows without a GSTIN, or with an invalid one, stay
-- NULL and can be set later by the operator.

BEGIN;

ALTER TABLE public.party    ADD COLUMN IF NOT EXISTS state_code text;
ALTER TABLE public.customer ADD COLUMN IF NOT EXISTS state_code text;
ALTER TABLE public.mill     ADD COLUMN IF NOT EXISTS state_code text;

COMMENT ON COLUMN public.party.state_code IS
  'GST state code (first 2 digits of GSTIN, e.g. 33 for Tamil Nadu). Used for IGST vs CGST/SGST detection on invoices.';
COMMENT ON COLUMN public.customer.state_code IS
  'GST state code (first 2 digits of GSTIN, e.g. 33 for Tamil Nadu).';
COMMENT ON COLUMN public.mill.state_code IS
  'GST state code (first 2 digits of GSTIN, e.g. 33 for Tamil Nadu).';

UPDATE public.party
   SET state_code = LEFT(gstin, 2)
 WHERE state_code IS NULL
   AND gstin IS NOT NULL
   AND gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$';

UPDATE public.customer
   SET state_code = LEFT(gstin, 2)
 WHERE state_code IS NULL
   AND gstin IS NOT NULL
   AND gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$';

UPDATE public.mill
   SET state_code = LEFT(gstin, 2)
 WHERE state_code IS NULL
   AND gstin IS NOT NULL
   AND gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$';

COMMIT;
