-- ============================================================================
-- 289: One answer to "which account can I pay from?"
--
-- PPK, 2026-09-08, after asking why ledger type exists at all: "fix it".
--
-- Six screens ask the same question and five of them answer it differently:
--
--   tds/new, tds/[id]        group in (CASH-IN-HAND, BANK ACCOUNTS, BANK OD)
--   expenses/new             type in (CASH, BANK) or code LED-OWNER-FUNDS
--   wages/new                type = CASH or BANK
--   loans/loan-form          type = CASH or BANK
--   payments                 type in (BANK, CASH)
--
-- Five copies of one rule, and they had already drifted. Owner funds showed
-- up only on Expenses, so a business cost PPK paid on his own card could be
-- recorded as an expense but not as a wage, a loan, or a TDS challan - even
-- though he pays TDS on the portal by card. And the group-based pair broke
-- outright when the CASH ledger sat in the wrong group (migration 286): the
-- TDS screen offered no cash option at all, while the four type-based
-- screens carried on fine. One rule, written down once, cannot drift out of
-- step with itself like that.
--
-- WHY A COLUMN AND NOT A SHARED LIST OF NAMES
-- A shared constant would still be a list of group or type names, and this
-- morning proved that neither field answers the question on its own. Type
-- cannot: CAPITAL covers owner funds (a real source) and the two drawings
-- ledgers (the opposite of one). Group cannot: CAPITAL ACCOUNT holds the
-- same three. The honest answer is that "can I spend from this?" is its own
-- fact about a ledger, so it gets its own column.
--
-- NEW BANK ACCOUNTS STILL JUST WORK
-- The flag defaults itself on INSERT from the group, so adding an HDFC
-- current account under BANK ACCOUNTS makes it spendable without PPK having
-- to know the flag exists. On UPDATE it is left alone, so a deliberate
-- untick sticks.
-- ============================================================================

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS is_payment_source boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ledger.is_payment_source IS
  'Can money be paid out of, or received into, this account? Drives every "Paid from" / "Received in" picker. Set automatically on insert for cash, bank and OD groups; owner funds is set by hand. See migration 289.';

-- Seed: cash, the banks, the OD, and owner funds.
UPDATE public.ledger l
SET is_payment_source = true
FROM public.ledger_group lg
WHERE lg.id = l.group_id
  AND lg.name IN ('CASH-IN-HAND', 'BANK ACCOUNTS', 'BANK OD A/C');

UPDATE public.ledger
SET is_payment_source = true
WHERE code = 'LED-OWNER-FUNDS';

-- Belt and braces: the two drawings ledgers share owner funds' group and
-- type but are the opposite of a payment source - money going out TO PPK.
UPDATE public.ledger
SET is_payment_source = false
WHERE name IN ('CREDIT CARD PAYMENT', 'PERSONAL EXPENSES');

-- New cash/bank/OD ledgers become spendable on their own.
CREATE OR REPLACE FUNCTION public.tg_ledger_default_payment_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_payment_source THEN RETURN NEW; END IF;

  SELECT true INTO NEW.is_payment_source
  FROM public.ledger_group lg
  WHERE lg.id = NEW.group_id
    AND lg.name IN ('CASH-IN-HAND', 'BANK ACCOUNTS', 'BANK OD A/C');

  -- No row matched: SELECT INTO leaves the column untouched, which is the
  -- false it arrived with. Nothing more to do.
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ledger_default_payment_source ON public.ledger;
CREATE TRIGGER trg_ledger_default_payment_source
  BEFORE INSERT ON public.ledger
  FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_default_payment_source();

-- Verify:
--   select l.name, lg.name as grp, l.is_payment_source
--   from ledger l join ledger_group lg on lg.id = l.group_id
--   where l.is_payment_source order by lg.name, l.name;
-- Expected 7: CASH, the four bank accounts, YES BANK OD, OWNER FUNDS (PPK).
