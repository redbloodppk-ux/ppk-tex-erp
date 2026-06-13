-- 160_invoice_vehicle_no_and_customer_address_sync.sql
--
-- Two ship-related changes to the invoice flow:
--
-- A) Vehicle number field. Adds invoice.vehicle_no (text, nullable in
--    DB so historic invoices stay valid; the application form treats
--    it as a mandatory field at save time). Printed on every invoice
--    next to the e-way bill block.
--
-- B) Customer address backfill from party. The invoice print template
--    pulls customer.billing_address to render the Bill To / Ship To
--    block. That column is the legacy single-line shape; the unified
--    party master now has structured address1..4. 161 of 164 GSTIN-
--    matched customers had a truncated address relative to the party
--    row. This migration syncs them by joining customer to party via
--    upper(gstin) and re-assembling the four lines with ', ' separators.
--
-- The backfill is gstin-keyed. Customers without a GSTIN and customers
-- whose GSTIN doesn't match any party row are left untouched.

-- ── A) Vehicle number column ──────────────────────────────────────
ALTER TABLE public.invoice
  ADD COLUMN IF NOT EXISTS vehicle_no text;

COMMENT ON COLUMN public.invoice.vehicle_no IS
  'Transport vehicle registration number (e.g. TN33-AB-1234). Required '
  'at the application layer for every new invoice; nullable in the DB '
  'so the column can be added in-place without backfilling pre-existing '
  'rows.';

-- ── B) Customer billing_address sync from party ───────────────────
UPDATE public.customer c
SET    billing_address = CONCAT_WS(', ',
         NULLIF(p.address1, ''),
         NULLIF(p.address2, ''),
         NULLIF(p.address3, ''),
         NULLIF(p.address4, '')
       )
FROM   public.party p
WHERE  upper(c.gstin) = upper(p.gstin)
  AND  c.gstin IS NOT NULL
  AND  c.status = 'active'
  AND  COALESCE(p.address1, p.address2, p.address3, p.address4) IS NOT NULL
  AND  COALESCE(c.billing_address, '') <> CONCAT_WS(', ',
         NULLIF(p.address1, ''),
         NULLIF(p.address2, ''),
         NULLIF(p.address3, ''),
         NULLIF(p.address4, '')
       );
