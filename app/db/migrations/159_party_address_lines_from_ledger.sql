-- 159_party_address_lines_from_ledger.sql
--
-- Add address1..address4 columns to party so the address shape mirrors
-- ledger.address1..address4. Until now party stored the postal address
-- in a single billing_address text field, which is awkward when the
-- same business already has a structured address sitting on its
-- ledger row. After this migration:
--
--   party.address1, address2, address3, address4   text NULL
--
-- and they are backfilled from ledger.address1..4 whenever the two
-- rows share a GSTIN. The legacy billing_address column stays in
-- place so any code still reading it keeps working; new writes go to
-- the structured fields.

ALTER TABLE public.party
  ADD COLUMN IF NOT EXISTS address1 text,
  ADD COLUMN IF NOT EXISTS address2 text,
  ADD COLUMN IF NOT EXISTS address3 text,
  ADD COLUMN IF NOT EXISTS address4 text;

-- Backfill from ledger via GSTIN. Only rows where both sides carry a
-- non-empty GSTIN and the party.address1 is currently NULL are
-- touched, so re-running the migration is safe.
UPDATE public.party p
SET    address1 = l.address1,
       address2 = l.address2,
       address3 = l.address3,
       address4 = l.address4
FROM   public.ledger l
WHERE  p.gstin IS NOT NULL
  AND  l.gstin IS NOT NULL
  AND  upper(p.gstin) = upper(l.gstin)
  AND  p.address1 IS NULL;

CREATE INDEX IF NOT EXISTS idx_party_gstin_upper
  ON public.party (upper(gstin)) WHERE gstin IS NOT NULL;
