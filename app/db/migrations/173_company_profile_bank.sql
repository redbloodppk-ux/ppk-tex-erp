-- 173_company_profile_bank.sql
--
-- The "Make all cheques payable to …" block on every invoice print
-- and DC print used to read from a hard-coded constant in
-- lib/company.ts. The user wants to maintain the bank details from
-- Settings → Company instead, so they can change the bank account
-- once and have every printed document pick it up.
--
-- Adds four nullable text columns. Existing rows stay valid; the
-- print template falls back to the old constant when a column is
-- NULL or empty.

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS bank_name        text,
  ADD COLUMN IF NOT EXISTS bank_account_no  text,
  ADD COLUMN IF NOT EXISTS bank_ifsc        text,
  ADD COLUMN IF NOT EXISTS bank_branch      text;

COMMENT ON COLUMN public.company_profile.bank_name       IS 'Bank name printed on invoices.';
COMMENT ON COLUMN public.company_profile.bank_account_no IS 'Bank account number printed on invoices.';
COMMENT ON COLUMN public.company_profile.bank_ifsc       IS 'Bank IFSC code printed on invoices.';
COMMENT ON COLUMN public.company_profile.bank_branch     IS 'Bank branch printed on invoices.';
