-- ============================================================================
-- 284: Paying a personal credit card is drawings, not a business expense.
--
-- PPK, 2026-09-07: "we need credit card payment in bank entries and manage
-- ledger because today we renew anthropic subscription and yesterday i paid
-- my son school fees and credit card payment also."
--
-- Asked whose card it is, he said it is his PERSONAL card. That settles the
-- accounting: the card balance is not a business liability at all, and when
-- the business bank pays that card bill, the business is handing money to
-- its proprietor. That is DRAWINGS — a balance-sheet movement — exactly
-- like the cash withdrawals already treated that way.
--
-- WHAT WAS WRONG
-- bank_category.pl_treatment decides whether a bank entry reaches the P&L,
-- and two categories were flagged 'expense' when they are nothing of the
-- sort:
--
--   CREDIT_CARD_PAYMENT   5 entries   Rs 1,35,000
--   PERSONAL_EXPENSES     2 entries   Rs   32,220
--
-- Rs 1,67,220 of "cost" that was never a cost. Profit has been understated
-- by that much all year, and school fees have been sitting in the accounts
-- as a business expense — which is the sort of thing that goes badly in a
-- scrutiny.
--
-- The fix is small because the system already had the right idea: cash
-- withdrawal, GST payment and loan principal are all 'balance_sheet'. These
-- two simply belong in that company.
--
-- ALSO: a CAPITAL ACCOUNT group, which the chart of accounts did not have,
-- so the two ledgers have somewhere honest to live. Under INDIRECT EXPENSES
-- they would keep reading as costs to anyone scanning the ledger list, even
-- once the P&L stopped counting them.
--
-- NOT DONE, deliberately: nothing is claimed back as a business expense.
-- Some of that Rs 1,35,000 may have paid for genuine business things bought
-- on the personal card — the Anthropic subscription is one. Splitting that
-- out needs the card statements, which the system does not have, and
-- guessing at it would be worse than leaving it whole.
--
-- Verified after applying:
--   CREDIT_CARD_PAYMENT  balance_sheet  5 entries  Rs 1,35,000
--   PERSONAL_EXPENSES    balance_sheet  2 entries  Rs   32,220
--   (CASH_WITHDRAW already balance_sheet, 33 entries — the same treatment)
--   both ledgers now sit under CAPITAL ACCOUNT
--   new SUBSCRIPTIONS category, pl_treatment 'expense', 0 entries so far
-- ============================================================================

-- 1. The P&L fix. This is what moves the profit figure.
UPDATE public.bank_category
SET pl_treatment = 'balance_sheet'
WHERE code IN ('CREDIT_CARD_PAYMENT', 'PERSONAL_EXPENSES')
  AND pl_treatment = 'expense';

-- 2. Somewhere honest for them to sit in the chart of accounts.
INSERT INTO public.ledger_group (code, name, notes)
SELECT 'CAPITAL', 'CAPITAL ACCOUNT',
       'Proprietor''s capital and drawings. Money the owner puts in or takes out is not income or expense - it belongs on the balance sheet. See migration 284.'
WHERE NOT EXISTS (SELECT 1 FROM public.ledger_group WHERE code = 'CAPITAL');

UPDATE public.ledger l
SET group_id = (SELECT id FROM public.ledger_group WHERE code = 'CAPITAL')
WHERE l.name IN ('CREDIT CARD PAYMENT', 'PERSONAL EXPENSES');

-- 3. A category for software/subscriptions bought FOR the business, so a
--    genuine cost like the Anthropic renewal has somewhere correct to go
--    when it is paid from the business account rather than the personal
--    card. Without it, the nearest fit is "Other".
--    direction is constrained to out_only / in_only / both.
INSERT INTO public.bank_category (code, name, direction, pl_treatment, display_order)
SELECT 'SUBSCRIPTIONS', 'Software & Subscriptions', 'out_only', 'expense', 45
WHERE NOT EXISTS (SELECT 1 FROM public.bank_category WHERE code = 'SUBSCRIPTIONS');

-- Verify:
--   select code, pl_treatment from bank_category
--   where code in ('CREDIT_CARD_PAYMENT','PERSONAL_EXPENSES','CASH_WITHDRAW');
-- Expected: all three 'balance_sheet'.
