-- 106_ledger_bank_details.sql
--
-- Bank-account specific fields for BANK-type ledgers. These columns
-- are present on every ledger row but only shown / required when the
-- ledger's type is BANK (the form gates the UI). Storing them on the
-- ledger row directly keeps the model simple and lets the printed
-- invoice / payment voucher pick the right account details by name.

BEGIN;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS bank_name        text,
  ADD COLUMN IF NOT EXISTS bank_account_no  text,
  ADD COLUMN IF NOT EXISTS bank_ifsc        text,
  ADD COLUMN IF NOT EXISTS bank_branch      text;

COMMENT ON COLUMN public.ledger.bank_name       IS 'Name of the bank for BANK-type ledgers (e.g. HDFC, SBI). NULL for non-bank ledgers.';
COMMENT ON COLUMN public.ledger.bank_account_no IS 'Account number for BANK-type ledgers. Stored as text to preserve leading zeros.';
COMMENT ON COLUMN public.ledger.bank_ifsc       IS 'IFSC code for BANK-type ledgers (e.g. HDFC0001234).';
COMMENT ON COLUMN public.ledger.bank_branch     IS 'Branch name for BANK-type ledgers. Optional.';

COMMIT;
