-- ============================================================================
-- 285: Owner funds — business costs PPK pays from his own pocket.
--
-- PPK, 2026-09-07: "business things on the personal card regularly because
-- i have only thing i have in my hand."
--
-- The previous answer assumed this was occasional and told him to pay
-- business subscriptions from the business account instead. That advice is
-- no use to someone with one card. Business costs go on his personal card
-- as a matter of course, so the books need somewhere honest to put them.
--
-- THE ACCOUNTING
-- When the proprietor pays a business cost personally, the business has
-- incurred an expense and now owes him the money. That is not a bank
-- movement at all — no business account was touched — which is why neither
-- the Bank Entries nor the Expenses screen could record it: both insist the
-- money came out of a CASH or BANK ledger.
--
-- OWNER FUNDS is that missing account. Spend on it and the business owes
-- PPK more; when the business later pays his card bill from its own bank
-- (already recorded as Credit card payment, drawings since migration 284),
-- that settles the debt the other way. Both sides live in CAPITAL ACCOUNT
-- and net off, which is exactly how a proprietor's capital account works.
-- Nothing has to be split by hand.
--
-- It is a ledger TYPE of its own rather than pretending to be CASH. Calling
-- it cash would put it in cash-in-hand reports and in every "how much cash
-- do we have" figure, which would be a lie — the money is in PPK's pocket,
-- not the mill's drawer.
--
-- The Expenses screen's "Paid from" picker was widened to CASH / BANK /
-- CAPITAL to match, with owner funds sorted last so the everyday choices
-- stay at the top.
--
-- Verified after applying: CAPITAL ACCOUNT holds OWNER FUNDS (PPK) beside
-- CREDIT CARD PAYMENT and PERSONAL EXPENSES — money in from the owner, and
-- money out to him, in one place.
-- ============================================================================

INSERT INTO public.ledger_type (name)
SELECT 'CAPITAL'
WHERE NOT EXISTS (SELECT 1 FROM public.ledger_type WHERE name = 'CAPITAL');

INSERT INTO public.ledger (code, name, type_id, group_id, active)
SELECT
  'LED-OWNER-FUNDS',
  'OWNER FUNDS (PPK)',
  (SELECT id FROM public.ledger_type  WHERE name = 'CAPITAL'),
  (SELECT id FROM public.ledger_group WHERE code = 'CAPITAL'),
  true
WHERE NOT EXISTS (SELECT 1 FROM public.ledger WHERE name = 'OWNER FUNDS (PPK)');

-- Verify:
--   select l.name, lt.name from ledger l
--   join ledger_type lt on lt.id = l.type_id
--   join ledger_group lg on lg.id = l.group_id where lg.code = 'CAPITAL';
-- Expected: OWNER FUNDS (PPK) / CAPITAL, plus the two drawings ledgers.
