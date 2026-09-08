-- ============================================================================
-- 290: Say what each ledger TYPE is for — and what it is not.
--
-- PPK, 2026-09-08: "why do we need ledger type?" A fair question, since
-- Tally has no such thing. The answer that these notes have to carry is the
-- division of labour:
--
--   GROUP  is for the accounts. Where does this balance land on the P&L or
--          the balance sheet? That is the accountant's question.
--   TYPE   is for the app. Which dropdown should this ledger appear in, and
--          how should the screen behave? That is the software's question.
--
-- Neither can do the other's job. SUNDRY CREDITORS holds 26 ledgers - yarn
-- mills, sizing mills, the calenderer, four brokers, mill stores - all
-- correctly in one group because PPK owes them all money. But opening a
-- sizing job must offer the three sizing mills, not all 26, and only the
-- type knows which three. The other way round, CASH and BANK are different
-- types but the same kind of money for the balance sheet.
--
-- Each note below names the ledgers actually carrying that type, so the
-- description can be checked against the real books, and says where it
-- shows up in the app - because "which screen does this affect" is the
-- thing you cannot work out from the name alone.
-- ============================================================================

UPDATE public.ledger_type SET notes =
  'Yarn brokers and commission agents - Raghu, Prafulla Kumar, Saravanan Cotton, Sivarathish Kumar, Yarn Varadharaj. Picks them out on the yarn purchase log. They sit under Sundry Creditors because you owe them commission.'
WHERE name = 'AGENT';

UPDATE public.ledger_type SET notes =
  'One per bank account, the overdraft included. Puts the account in every "Paid from" list. The group tells the accounts apart - Bank Accounts for the four, Bank OD A/C for the Yes Bank OD.'
WHERE name = 'BANK';

UPDATE public.ledger_type SET notes =
  'Your own money crossing the business boundary - Owner funds (in), Credit card payment and Personal expenses (out). Note the type alone cannot say which way: that is what the payment-source tick box on each ledger is for.'
WHERE name = 'CAPITAL';

UPDATE public.ledger_type SET notes =
  'Physical cash. Just the one ledger, CASH. Marks it as spendable, and it is the default choice on the wage and expense forms because that is how most of the mill''s money actually moves.'
WHERE name = 'CASH';

UPDATE public.ledger_type SET notes =
  'Chit fund subscriptions - Kongu Chit, Madhan Chit1. Kept separate from bank so they never count as money you can spend today; the cash is committed until the chit matures.'
WHERE name = 'CHIT';

UPDATE public.ledger_type SET notes =
  'Cloth buyers - 163 of them, every one auto-created with the party. Fills the customer picker on invoices, delivery challans and receipts. Never set this by hand; add the party and the ledger follows.'
WHERE name = 'CUSTOMER';

UPDATE public.ledger_type SET notes =
  'Running-cost heads, not people - EB, insurance, bank charges, maintenance, office, professional fees, loan interest. Seven of them. A cost you pay a named party goes on that party''s ledger instead.'
WHERE name = 'EXPENSES';

UPDATE public.ledger_type SET notes =
  'Earnings heads, not people - Interest income, Rental income, Scrap. The tenant or the buyer has their own ledger; only the earning itself sits on one of these.'
WHERE name = 'INCOME';

UPDATE public.ledger_type SET notes =
  'A customer who sends you their own yarn and pays you only to weave it - BMPT Textiles, Sri Murugan Tex. Separated from plain CUSTOMER because job-work billing charges for labour, not for cloth.'
WHERE name = 'JOB WORK(CUSTOMER)';

UPDATE public.ledger_type SET notes =
  'Money owed that is not a trade bill - GST Payable, TDS Payable, and the loan from Kumar. Tax collected or deducted is the government''s money sitting with you, which is why it is a liability and never income.'
WHERE name = 'LIABILITY';

UPDATE public.ledger_type SET notes =
  'A borrowing with a repayment schedule - the vehicle loan. Only the principal lives here; the interest is a running cost and goes to Loan interest expense under Indirect Expenses.'
WHERE name = 'LOAN';

UPDATE public.ledger_type SET notes =
  'A tenant renting your premises - Varnaa Cotton Mills, Venkateshwarra Stores. The invoice screen checks this type and lays a rent bill out differently from a cloth bill. They sit under Sundry Debtors, because they owe you.'
WHERE name = 'RENTAL';

UPDATE public.ledger_type SET notes =
  'Warping and sizing mills - Om Muruga, Shri Nithya, Sree Rukmani. This is what makes a sizing job offer these three and not all 26 creditors. TDS under section 194C applies to their bills.'
WHERE name = 'SIZING(VENDOR)';

UPDATE public.ledger_type SET notes =
  'Anyone you buy from - yarn mills, mill stores, engineering, computers. Fifteen of them. Set automatically for any party added as Mill / Yarn Supplier, Bobbin Supplier or General.'
WHERE name = 'SUPPLIER';

UPDATE public.ledger_type SET notes =
  'Transport and finishing services - Venkateswara Calendering Mills. A vendor you pay, so the ledger belongs under Sundry Creditors; the type is what keeps it out of the yarn and sizing pickers.'
WHERE name = 'TRANSPORT';

UPDATE public.ledger_type SET notes =
  'The head every weekly wage posts to - Weaver wages. Under Direct Expenses, because for a weaving mill labour is part of making the cloth, not an office overhead.'
WHERE name = 'WAGES';

UPDATE public.ledger_type SET notes =
  'An outside weaver you send beams to - Deepa Tex. This is what the pavu screen offers when a beam is routed out rather than run in-house.'
WHERE name = 'WEAVING(VENDOR)';

-- Verify:
--   select name, notes is not null as has_note from ledger_type order by name;
-- Expected: all 17 types carry a note.
