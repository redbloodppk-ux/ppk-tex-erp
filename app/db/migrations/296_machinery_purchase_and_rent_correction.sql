-- ============================================================================
-- 296: Close the cash gap the cash book exposed.
--
-- Migration 295 made the cash rule complete and the drawer then read
-- Rs 2,11,050 more than PPK could count. This migration accounts for that
-- difference. Nothing here is a plug: each piece was checked against PPK
-- and the result lands on his counted figure to the rupee.
--
-- WHAT THE Rs 2,11,050 TURNED OUT TO BE
--
-- 1. KONGU CHIT, Rs 2,01,450, 15-Jul (BE/26-27/0061)
--    PPK: "201450 is not hand now" ... "used machine expenditure".
--    The receipt is right - the chit money did come into the drawer. What
--    was never recorded is where it went: he bought machinery with it, in
--    cash, in the second half of July. So the fix is a missing PAYMENT,
--    not a corrected receipt.
--
-- 2. SCRAP, Rs 2,600, 12-Jun (BE/26-27/0056)
--    PPK: "Leave it as cash". Received in notes, correctly recorded. It
--    went out with the machinery money, which is why the two add up:
--    2,01,450 + 2,600 = 2,04,050, exactly the shortfall once the rent
--    entry below is corrected.
--
-- 3. RENTAL INCOME, Rs 7,000, 16-Jun (BE/26-27/0055)
--    Recorded against CASH. Every one of the other nine rent receipts in
--    the year goes to PRAVEEN KOTAK SAVINGS; this is the only one naming
--    cash, so it reads as a slip of the account picker.
--    ASSUMPTION: PPK did not answer on this one, so it is moved to
--    PRAVEEN KOTAK SAVINGS on the strength of the other nine. If the rent
--    really was collected in notes, revert this statement and instead
--    reduce the machinery figure below by 7,000.
--
-- THE ARITHMETIC, CHECKED BEFORE APPLYING
--   cash at close 11-Sep, complete rule      2,87,290
--   less rent moved to savings                  -7,000
--   less machinery bought in cash            -2,04,050
--   =                                           76,240   <- PPK's count
--
-- WHY A NEW GROUP AND A NEW CATEGORY
-- There was nowhere to put a machine. The chart of accounts had no Fixed
-- Assets group, and bank_category had no balance-sheet head for buying
-- one - the nearest, MAINTENANCE, is an expense and would have dropped
-- Rs 2,04,050 straight through this year's P&L. A machine is an asset you
-- still own, not a cost you incurred, so both are created here.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. A trigger from migration 289 that blocks new ledgers
--
-- Found while creating PLANT & MACHINERY below: the insert failed with
-- "null value in column is_payment_source violates not-null constraint".
--
-- tg_ledger_default_payment_source did this:
--
--     SELECT true INTO NEW.is_payment_source
--     FROM ledger_group lg
--     WHERE lg.id = NEW.group_id AND lg.name IN (the three payment groups);
--
-- SELECT ... INTO assigns NULL when no row matches. So for a ledger in any
-- OTHER group the trigger wrote NULL into a NOT NULL column, and the insert
-- died. The guard above it, IF NEW.is_payment_source, is NULL rather than
-- false on a fresh insert, so it never short-circuits either.
--
-- Nothing had hit this yet only because every ledger created since 289 -
-- the eight suppliers in migration 286 - predates the trigger. It would
-- have broken the next ledger anyone added through the UI, whatever it
-- was. Rewritten with EXISTS, which yields false rather than NULL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_ledger_default_payment_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.is_payment_source, false) THEN
    RETURN NEW;
  END IF;

  NEW.is_payment_source := EXISTS (
    SELECT 1 FROM public.ledger_group lg
     WHERE lg.id = NEW.group_id
       AND lg.name IN ('CASH-IN-HAND', 'BANK ACCOUNTS', 'BANK OD A/C')
  );

  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Somewhere for an asset to live
-- ----------------------------------------------------------------------------
INSERT INTO public.ledger_group (code, name, active, notes)
VALUES ('LG-0020', 'FIXED ASSETS', true,
        'Things the mill owns and keeps - looms, motors, machinery, vehicles. '
        'Buying one is not a cost: the money turns into a machine you still '
        'have, so it sits on the balance sheet and never touches profit. Only '
        'the wear each year (depreciation, posted by your CA) is a cost.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger_type (code, name, active, notes)
VALUES ('LT-0055', 'FIXED ASSET', true,
        'A ledger holding something the mill owns long term. Its balance is '
        'what that asset stands at in the books, not money owed or earned.')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.ledger (code, name, group_id, type_id, active, notes)
SELECT 'LED-PLANT-MACHINERY', 'PLANT & MACHINERY',
       (SELECT id FROM public.ledger_group WHERE code = 'LG-0020'),
       (SELECT id FROM public.ledger_type  WHERE code = 'LT-0055'),
       true,
       'Machinery bought for the mill. Every purchase adds to it; your CA '
       'writes down depreciation against it at year end.'
WHERE NOT EXISTS (SELECT 1 FROM public.ledger WHERE code = 'LED-PLANT-MACHINERY');

-- A balance-sheet head, so buying a machine does not read as an expense.
INSERT INTO public.bank_category (code, name, direction, pl_treatment, display_order, active)
VALUES ('MACHINERY_PURCHASE', 'Machinery Purchase', 'out_only', 'balance_sheet', 85, true)
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. The rent receipt that named cash (see the assumption above)
-- ----------------------------------------------------------------------------
UPDATE public.bank_entry
SET bank_ledger_id = (SELECT id FROM public.ledger WHERE name = 'PRAVEEN KOTAK SAVINGS'),
    notes = COALESCE(notes || ' | ', '')
            || 'Account corrected from CASH to PRAVEEN KOTAK SAVINGS (migration 296): '
            || 'the other nine rent receipts this year all go to savings.'
WHERE entry_no = 'BE/26-27/0055'
  AND bank_ledger_id = (SELECT id FROM public.ledger WHERE name = 'CASH'
                         AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH'));

-- ----------------------------------------------------------------------------
-- 3. The machinery bought with the chit money
--
-- Dated 31-Jul-2026: PPK said the second half of July, and the chit only
-- matured on the 15th. One entry rather than several because the split
-- across the fortnight is not known - the total is what reconciles.
-- ----------------------------------------------------------------------------
INSERT INTO public.bank_entry
  (entry_no, entry_date, direction, amount, bank_ledger_id, other_ledger_id,
   category_id, mode, notes, status)
SELECT
  'BE/26-27/0086', DATE '2026-07-31', 'out', 204050,
  (SELECT id FROM public.ledger WHERE name = 'CASH'
    AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH')),
  (SELECT id FROM public.ledger WHERE code = 'LED-PLANT-MACHINERY'),
  (SELECT id FROM public.bank_category WHERE code = 'MACHINERY_PURCHASE'),
  'cash',
  'Machinery bought in cash out of the Kongu chit maturity (BE/26-27/0061, '
  'Rs 2,01,450) and the scrap sale (BE/26-27/0056, Rs 2,600). Reconstructed '
  'by migration 296 - the payment was never entered at the time, which is '
  'why cash in hand read Rs 2,04,050 too high. Date is approximate: PPK '
  'placed it in the second half of July.',
  'active'
WHERE NOT EXISTS (SELECT 1 FROM public.bank_entry WHERE entry_no = 'BE/26-27/0086');

-- Verify:
--   select balance from fn_cash_in_hand(DATE '2026-09-11');   -- expect 76,240
--   select * from fn_cash_book_day(DATE '2026-07-31');        -- the new entry
