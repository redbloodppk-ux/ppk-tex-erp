-- ============================================================================
-- 288: Say what each account group is for, in plain words.
--
-- PPK, 2026-09-08: "fill all the notes describe about the ledger group".
--
-- Only CAPITAL ACCOUNT had a note. The rest were blank, so the only way to
-- know where a new ledger belongs was to already know accounting. Each note
-- below says what the group holds, names the ledgers actually in it so the
-- description can be checked against the real books, and where there is a
-- rule worth remembering it gives the test rather than the theory.
--
-- The five inactive groups say why they are switched off, so that switching
-- one back on later is a decision made with the reason in view.
-- ============================================================================

UPDATE public.ledger_group SET notes =
  'Your current and savings accounts - Kotak Current, Yes Bank Current and the two personal savings. One ledger per account so each matches its own passbook.'
WHERE name = 'BANK ACCOUNTS';

UPDATE public.ledger_group SET notes =
  'Overdraft accounts - Yes Bank OD. Kept apart from Bank Accounts because an OD is money borrowed, so it normally shows a credit (minus) balance, not a positive one.'
WHERE name = 'BANK OD A/C';

UPDATE public.ledger_group SET notes =
  'Your own money in the business. Owner funds is what you put in; credit card payment and personal expenses are what you take out. Never profit or cost - it stays off the P&L.'
WHERE name = 'CAPITAL ACCOUNT';

UPDATE public.ledger_group SET notes =
  'Physical cash in the mill - the CASH ledger. Wages, small expenses and any TDS challan paid in notes come out of here.'
WHERE name = 'CASH-IN-HAND';

UPDATE public.ledger_group SET notes =
  'Costs of actually making the cloth - weaver wages. The test: if the looms stopped tomorrow, would this cost stop too? If yes, it is direct.'
WHERE name = 'DIRECT EXPENSES';

UPDATE public.ledger_group SET notes =
  'Earnings from your main work - job-work and weaving charges. Empty for now: a JOB WORK INCOME head belongs here, not under Indirect Incomes.'
WHERE name = 'DIRECT INCOMES';

UPDATE public.ledger_group SET notes =
  'Tax you have collected or deducted and must hand to the government - GST Payable, TDS Payable. It is their money sitting with you, so it is a liability, not income.'
WHERE name = 'DUTIES & TAXES';

UPDATE public.ledger_group SET notes =
  'Running costs that carry on whether the looms run or not - EB, insurance, bank charges, maintenance, office expenses, professional fees, loan interest.'
WHERE name = 'INDIRECT EXPENSES';

UPDATE public.ledger_group SET notes =
  'Money earned outside weaving - rent received, bank interest, scrap sales. Only the income head sits here; the tenant who owes the rent goes under Sundry Debtors.'
WHERE name = 'INDIRECT INCOMES';

UPDATE public.ledger_group SET notes =
  'Money parked outside the business that you expect to get back - the Kongu and Madhan chits. An asset while it is out there, not an expense.'
WHERE name = 'INVESTMENTS';

UPDATE public.ledger_group SET notes =
  'Money you have borrowed and must repay - the vehicle loan, and the loan from Kumar. Only the principal sits here; the interest is a cost and goes to Indirect Expenses.'
WHERE name = 'LOANS (LIABILITY)';

UPDATE public.ledger_group SET notes =
  'Money you have paid out that is still owed back to you - an advance to a yarn or sizing mill before delivery. Empty for now. It is an asset, not an expense.'
WHERE name = 'LOANS & ADVANCES (ASSET)';

UPDATE public.ledger_group SET notes =
  'Everyone you owe money to - yarn mills, sizing mills, brokers, transport, mill stores. One ledger per party; their unpaid bills are what you have to pay.'
WHERE name = 'SUNDRY CREDITORS';

UPDATE public.ledger_group SET notes =
  'Everyone who owes you money - cloth customers, job-work parties and rent tenants. One ledger per party; their unpaid invoices are your outstanding.'
WHERE name = 'SUNDRY DEBTORS';

-- The five switched off in migration 287. The note explains why, so anyone
-- turning one back on can see what they are taking on.

UPDATE public.ledger_group SET notes =
  'Switched off. A Tally system account you never post to by hand - this ERP works profit out from the entries themselves.'
WHERE name = 'PROFIT & LOSS A/C';

UPDATE public.ledger_group SET notes =
  'Switched off. In Tally a purchase bill posts to a head under this group; here it posts against the supplier''s own ledger instead, so nothing can reach it.'
WHERE name = 'PURCHASE ACCOUNTS';

UPDATE public.ledger_group SET notes =
  'Switched off. In Tally a sales bill posts to a head under this group; here it posts against the customer''s ledger and sales are totalled from the invoices.'
WHERE name = 'SALES ACCOUNTS';

UPDATE public.ledger_group SET notes =
  'Switched off. Yarn, beams and fabric are tracked as stock in their own screens, not as ledgers. Your CA posts closing stock here in Tally at year end.'
WHERE name = 'STOCK-IN-HAND';

UPDATE public.ledger_group SET notes =
  'Switched off. Tally''s parking place for entries you cannot classify yet. Every screen here makes you pick a category, so nothing can land in it.'
WHERE name = 'SUSPENSE A/C';

-- Verify:
--   select name, active, notes is not null as has_note from ledger_group
--   order by name;
-- Expected: all 19 groups carry a note.
