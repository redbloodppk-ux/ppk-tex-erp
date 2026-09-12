-- ============================================================================
-- 293: Anchor the cash ledger to the money actually in the drawer.
--
-- PPK, 2026-09-12: "cash in my hand is 76240 but it cash ledger it showing
-- negative value why?" — then, on being shown the opening row: "you can
-- modify the opening that was my guess figure".
--
-- TWO FAULTS IN ONE ROW
--
-- 1. WRONG SIDE. The opening was Rs 2,63,259 marked Cr. Cash in hand is an
--    asset, so it belongs on the Dr side. As entered the ledger started
--    Rs 2.63 lakh in the negative rather than positive — a Rs 5,26,518
--    swing, and the single biggest reason the running balance reads below
--    zero all year.
--
-- 2. WRONG DATE. It was dated 24-May-2026, but 13 cash movements worth
--    +Rs 9,46,369 already sit between 1 April and 23 May. An opening
--    balance is the position BEFORE anything recorded; this one sat in the
--    middle, so April and May were counted on top of a figure that should
--    have already contained them.
--
-- HOW THE NEW FIGURE WAS DERIVED
-- Not guessed. Every ledger reference to CASH was enumerated first —
-- payment.mode_ledger_id (20), bank_entry both sides (11 out, 28 in),
-- wage_entry.source (517), expense_entry.source (238),
-- employee_loan.source (10). payment.ledger_id, the wage and expense
-- target columns and tds_payment.source were all confirmed empty, so
-- nothing is unaccounted for.
--
--   movements 01-Apr to 12-Sep        +   29,099
--   cash counted in hand on 12-Sep        76,240
--   therefore opening at 01-Apr           47,141 Dr
--
-- Dated 1 April 2026, the start of the financial year, so it sits before
-- every recorded movement and cannot overlap live data again.
--
-- NOTE ON THE OLD FIGURE: Rs 2,63,259 was PPK's estimate, not a count. It
-- is replaced rather than adjusted because there is nothing to reconcile
-- it to — the only hard number in this is the cash he counted today.
-- ============================================================================

UPDATE public.ledger
SET opening_date   = DATE '2026-04-01',
    opening_amount = 47141,
    opening_dr_cr  = 'Dr'
WHERE name = 'CASH'
  AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH');

-- Verify: the ledger's closing balance should now be 76,240.
--   opening 47,141 Dr + net movements 29,099 = 76,240
