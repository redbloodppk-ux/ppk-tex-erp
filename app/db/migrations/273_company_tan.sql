-- 273_company_tan.sql
--
-- TAN — the Tax Deduction Account Number quoted on every TDS challan and
-- return. PPK's is CMBP07772C, confirmed from his own challan receipt of
-- 06-Jan-2026 (ITNS 281, CIN 26010600792141KKBK).
--
-- Goes on company_profile beside gstin and pan, which is where the other
-- statutory identifiers already live. It is the deductor's number, one per
-- business, not per party — party.gstin is a different thing entirely.
--
-- FORMAT
-- Four letters, five digits, one letter: AAAA00000A. CMBP07772C fits.
-- The check is deliberately loose about nothing else — a wrong TAN is
-- rejected at the portal, not here, and a constraint that guesses harder
-- than the department does would block a valid number one day.
--
-- WORTH KNOWING, from that same receipt
--   Major Head 0021, "Income Tax (Other than Companies)" - PPK deducts as
--   an individual/proprietor, not a company. That affects the CHALLAN, not
--   the rate: the 194C rate follows the PAYEE's status, so SHRI NITHYA at
--   2% is unaffected (migration 271).
--   Nature of Payment 94C - section 194C, contractors. Sizing work is
--   exactly that, which corroborates the 2% already recorded.

BEGIN;

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS tan text;

ALTER TABLE public.company_profile
  DROP CONSTRAINT IF EXISTS company_profile_tan_format;
ALTER TABLE public.company_profile
  ADD CONSTRAINT company_profile_tan_format
  CHECK (tan IS NULL OR tan ~ '^[A-Z]{4}[0-9]{5}[A-Z]$');

COMMENT ON COLUMN public.company_profile.tan IS
  'Tax Deduction Account Number of the deductor, format AAAA00000A. '
  'Quoted on every TDS challan and quarterly return. See migration 273.';

UPDATE public.company_profile SET tan = 'CMBP07772C' WHERE tan IS NULL;

COMMIT;

-- Verify: select legal_name, gstin, tan from company_profile;
