-- ============================================================================
-- 298: Put the 16-Jun rent back on cash, where PPK says it belongs.
--
-- PPK, 2026-09-14, asked whether the Rs 7,000 rent of 16-Jun was collected
-- in notes or paid into savings: "is cash only".
--
-- WHAT THIS UNDOES
-- Migration 296 moved BE/26-27/0055 off CASH to PRAVEEN KOTAK SAVINGS. That
-- was an assumption, not a fact, and it was flagged as one at the time: the
-- other nine rent receipts in the year all go to savings, so the tenth
-- looked like a slip of the account picker.
--
-- It was not a slip. The evidence came from PPK himself the next day, when
-- he entered BE/26-27/0088 - Rs 7,000 of rent received straight into cash.
-- He collects rent in notes sometimes. The pattern I generalised from was
-- real but it was not a rule.
--
-- WHAT IT COSTS
-- The Rs 7,000 goes back into the drawer, so the unrecorded cash that left
-- it must be Rs 7,000 larger. The machinery entry BE/26-27/0086 moves from
-- Rs 2,04,050 to Rs 2,11,050.
--
--   cash at close 11-Sep, all receipts counted      2,87,290
--   less machinery bought in cash                  -2,11,050
--   =                                                 76,240   <- PPK's count
--
-- and 2,11,050 is now exactly the three receipts that were in the books but
-- not in the drawer: chit 2,01,450 + scrap 2,600 + rent 7,000.
--
-- A CORRECTION TO WHAT I TOLD PPK
-- I said this change would take the machinery figure DOWN to Rs 1,97,050.
-- That was wrong - I subtracted the 7,000 where I should have added it.
-- More cash in the drawer means more cash had to leave it to end at the
-- same Rs 76,240. The figure goes UP, to Rs 2,11,050.
--
-- THE ASSUMPTION THAT REMAINS
-- PPK's own account covers the chit: "used machine expenditure". The
-- scrap Rs 2,600 and this rent Rs 7,000 - Rs 9,600 between them - are
-- bundled into the same entry because the drawer cannot tell where they
-- went, only that they went. If that Rs 9,600 was actually spent on
-- something else, split it out and reduce this entry by the same amount;
-- the drawer reconciles either way.
-- ============================================================================

UPDATE public.bank_entry
SET bank_ledger_id = (SELECT id FROM public.ledger WHERE name = 'CASH'
                       AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH')),
    notes = 'Rent received in cash. Migration 296 moved this to PRAVEEN KOTAK '
            'SAVINGS on the pattern of the other nine rent receipts; PPK '
            'confirmed on 14-Sep it was "cash only", so migration 298 put it '
            'back.'
WHERE entry_no = 'BE/26-27/0055';

UPDATE public.bank_entry
SET amount = 211050,
    notes = 'Machinery bought in cash out of the Kongu chit maturity '
            '(BE/26-27/0061, Rs 2,01,450), the scrap sale (BE/26-27/0056, '
            'Rs 2,600) and the June rent (BE/26-27/0055, Rs 7,000) - the '
            'three receipts that are in the books but were not in the drawer. '
            'Reconstructed by migrations 296 and 298; the payment was never '
            'entered at the time, which is why cash in hand read Rs 2,11,050 '
            'too high. Date is approximate: PPK placed it in the second half '
            'of July.'
WHERE entry_no = 'BE/26-27/0086';

-- Verify:
--   select balance from fn_cash_in_hand(DATE '2026-09-11');  -- expect 76,240
