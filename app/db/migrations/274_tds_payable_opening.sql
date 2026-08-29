-- 274_tds_payable_opening.sql
--
-- Opening balance for LED-0196 TDS PAYABLE, so the ledger stops showing a
-- phantom overpayment.
--
-- WHAT WAS WRONG
-- The ledger carried a payment with nothing to settle. On 07-Apr-2026 a
-- bank entry of Rs 2,051 was recorded against TDS PAYABLE - a real
-- challan, receipt CIN 26040700598462KKBK, Rs 1,986 tax + Rs 65 interest,
-- for tax deducted in Jan-Mar 2026.
--
-- But those Jan-Mar deductions were never booked as a liability here: the
-- ERP's sizing bills start in April 2026. So the ledger showed money going
-- OUT with no corresponding debt, and the running balance drifted Rs 2,051
-- to the wrong side. Every later row inherited the error, ending at
-- Rs 1,770.20 on the wrong side of zero.
--
-- Nothing was wrong with the entries. The opening position was missing.
--
-- THE OPENING FIGURE
-- Rs 2,051 credit as at 01-Apr-2026 - what was genuinely owed to the
-- department that morning. That is the full challan, tax AND interest,
-- because both were owed on that date and both were settled by the same
-- payment. Booking only the Rs 1,986 tax would leave the Rs 65 stranded as
-- an overpayment and put the ledger out by exactly that much.
--
-- Strictly, interest is an expense rather than tax withheld, so a purist
-- would post it to an interest ledger. That is a defensible refinement,
-- but it would leave this account not balancing against a receipt PPK can
-- hold in his hand - and matching the receipt is worth more here than the
-- classification nicety.
--
-- WHAT THE LEDGER READS AFTER THIS
--   01-Apr  opening                        -2,051.00
--   07-Apr  challan paid (Jan-Mar)              0.00
--   Apr-Aug tax withheld, five bills        -1,521.14
--   29-Aug  challans for Apr, May, Jun        -280.80
--
-- Closing -280.80, meaning Rs 280.80 owed - exactly August's TDS, which is
-- the one month still unpaid on /app/tds. The ledger and the TDS screen
-- now agree, which is the point.
--
-- On the sign: this app reads a NEGATIVE running balance as "we owe",
-- consistently across supplier and tax ledgers alike. See
-- withRunningBalance in app/ledgers/ledger-view-query.ts.

BEGIN;

UPDATE public.ledger
SET opening_amount = 2051.00,
    opening_dr_cr  = 'Cr',
    opening_date   = DATE '2026-04-01',
    notes = COALESCE(notes || E'\n', '') ||
      'Opening 2,051.00 Cr at 01-Apr-2026 = TDS on Jan-Mar 2026 deductions '
      '(1,986 tax + 65 interest), settled by challan 33386 on 07-Apr-2026, '
      'CIN 26040700598462KKBK. Those deductions predate the ERP, so the '
      'liability had to be carried in rather than derived. Migration 274.'
WHERE name = 'TDS PAYABLE';

COMMIT;

-- Verify: the closing balance on /app/ledgers for TDS PAYABLE should be
-- -280.80, matching the single unpaid month on /app/tds.
