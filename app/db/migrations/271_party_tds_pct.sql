-- 271_party_tds_pct.sql
--
-- TDS rate per party, so the deduction can be shown on bills and later
-- netted off what we owe. Requested by PPK, 2026-08-29: "all nithiya
-- sizing tds is 2% from taxable value".
--
-- WHY PER PARTY AND NOT A CONSTANT
-- Section 194C is 2% for a company or firm and 1% for an individual or
-- HUF, and some parties are nil-deduction. Every sizing bill in the system
-- today happens to be SHRI NITHYA, so hardcoding 2% would have looked
-- correct - and there are already THREE sizing mills on the party master:
--
--   19  SHRI NITHYA SIZING MILL              <- 2%
--   18  SHREE RUKUMANI WARPING & SIZING MILL <- no rate set
--   202 OM MURUGA SIZING MILL                <- no rate set
--
-- A constant would have quietly deducted 2% from both of the others the
-- first time they were billed. That is the same failure mode as matching
-- invoices on party_name (migration 262) and reading a missing attendance
-- row as presence: a default standing in for a fact.
--
-- NULL means "no TDS on this party" and is the default, so a new party
-- never inherits a rate by accident. The bill screen shows a dash rather
-- than zero, to keep "not applicable" distinct from "計 zero" - the same
-- distinction that cost three money bugs this week when `none` meant
-- several things at once.
--
-- TAXABLE VALUE, NOT TOTAL
-- TDS is computed on the charges BEFORE GST. On bill 11:
--   charges 14,040.00 x 2% = 280.80, not 14,742.00 x 2% = 294.84.
-- The bill screen computes it from charges_amount for that reason.

BEGIN;

ALTER TABLE public.party
  ADD COLUMN IF NOT EXISTS tds_pct numeric(5,2);

ALTER TABLE public.party
  DROP CONSTRAINT IF EXISTS party_tds_pct_range;
ALTER TABLE public.party
  ADD CONSTRAINT party_tds_pct_range
  CHECK (tds_pct IS NULL OR (tds_pct >= 0 AND tds_pct <= 100));

COMMENT ON COLUMN public.party.tds_pct IS
  'TDS deduction rate for this party, in percent, applied to the TAXABLE '
  'value of a bill (charges before GST). NULL = no TDS, and is the '
  'default so a new party never inherits a rate. Section 194C is 2% for a '
  'company or firm, 1% for an individual or HUF. See migration 271.';

UPDATE public.party SET tds_pct = 2.00 WHERE id = 19;   -- SHRI NITHYA SIZING MILL

COMMIT;

-- Verify:
--   select id, name, tds_pct from party where tds_pct is not null;
-- Expected: exactly one row, SHRI NITHYA SIZING MILL at 2.00.
