-- 085_invoice_ewaybill_fields.sql
--
-- E-waybill capture on every invoice.
--
-- E-waybill is mandatory for movement of goods worth >Rs 50,000. The mill
-- generates the EWB on the gov portal (https://ewaybill.gov.in) and pastes
-- the number + validity back here, or a future migration can wire a GSP
-- API (e.g. Sandbox, Cygnet, ClearTax) to generate it directly from the
-- Generate button on the invoice detail page.

ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS ewaybill_no         text,
  ADD COLUMN IF NOT EXISTS ewaybill_date       date,
  ADD COLUMN IF NOT EXISTS ewaybill_valid_till date,
  ADD COLUMN IF NOT EXISTS ewaybill_notes      text;

COMMENT ON COLUMN public.invoice.ewaybill_no IS
  'GST e-waybill number captured from ewaybill.gov.in (or a GSP API).';
COMMENT ON COLUMN public.invoice.ewaybill_valid_till IS
  'E-waybill validity end date - movement must complete before this.';
