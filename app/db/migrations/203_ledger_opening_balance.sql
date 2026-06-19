-- 203_ledger_opening_balance.sql
--
-- Opening balance for accounting ledgers (BANK, AGENT, CASH, TAX,
-- SIZING/WEAVING vendor, TRANSPORT, WAREHOUSE, …). Customer- and
-- supplier-type ledgers already carry their pre-ERP outstanding via
-- party_opening_ledger, so the UI hides these fields for those types to
-- avoid double counting — but the columns live on every row for a clean,
-- single shape.
--
-- A ledger opening is a single figure as on a date, with an explicit
-- Debit / Credit side (mirroring the Tally-style trial balance the
-- operator is used to):
--   Dr → asset / receivable side (positive running balance)
--   Cr → liability / payable side (negative running balance)

BEGIN;

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS opening_date   date,
  ADD COLUMN IF NOT EXISTS opening_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opening_dr_cr  text;

-- Side is only meaningful when there is a non-zero opening amount.
-- Allow NULL (no opening) or one of the two sides.
ALTER TABLE public.ledger
  DROP CONSTRAINT IF EXISTS ledger_opening_dr_cr_chk;
ALTER TABLE public.ledger
  ADD CONSTRAINT ledger_opening_dr_cr_chk
  CHECK (opening_dr_cr IS NULL OR opening_dr_cr IN ('Dr', 'Cr'));

COMMIT;
