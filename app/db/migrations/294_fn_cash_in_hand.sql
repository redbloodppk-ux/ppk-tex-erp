-- ============================================================================
-- 294: fn_cash_in_hand — one number for "how much cash is in the drawer".
--
-- PPK, 2026-09-12: "make sure cash in and out flow will maintain correctly.
-- every day remind that how much cash in my hand so it will be easy to
-- track money", then "in erp itself highlight the cash in hand in dashboard".
--
-- WHY A FUNCTION AND NOT A QUERY IN THE PAGE
-- Cash moves through six different tables. If the dashboard card counted
-- them one way and a report counted them another, the two would drift and
-- there would be no way to tell which was right. So the rule lives once,
-- here, and every screen asks this function.
--
-- THE SIX SOURCES (all confirmed non-empty except where noted)
--   payment.mode_ledger_id        20 rows  cash received / paid to parties
--   bank_entry.other_ledger_id    39 rows  withdrawn from bank into cash
--   bank_entry.bank_ledger_id     11 rows  cash deposited into bank
--   wage_entry.source_ledger_id  517 rows  wages paid in cash
--   expense_entry.source_ledger_id 238 rows expenses paid in cash
--   employee_loan.source_ledger_id 10 rows  advances given in cash
-- payment.ledger_id, wage_entry.target_ledger_id,
-- expense_entry.target_ledger_id and tds_payment.source were all checked
-- and are empty, so nothing is missed.
--
-- The opening row is honoured with its Dr/Cr flag: Dr adds, Cr subtracts.
-- See migration 293 for why the opening is 47,141 Dr at 01-Apr-2026.
--
-- NOTE: this file was reconstructed from the live database definition —
-- it was applied directly during the session it was written and the file
-- was not saved at the time. Migration 295 supersedes the body of this
-- function; it is kept here so the history reads in order.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_cash_in_hand(p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE(balance numeric, day_in numeric, day_out numeric, as_of date)
LANGUAGE sql
STABLE
AS $function$
  WITH c AS (SELECT id, opening_amount, opening_dr_cr, opening_date
               FROM public.ledger WHERE name = 'CASH'
                AND type_id = (SELECT id FROM public.ledger_type WHERE name='CASH')
              LIMIT 1),
  mv AS (
    SELECT p.payment_date AS d,
           CASE WHEN p.direction='in' THEN p.amount ELSE -p.amount END AS amt
      FROM public.payment p
     WHERE p.mode_ledger_id = (SELECT id FROM c) AND p.status='active'
    UNION ALL
    SELECT be.entry_date, be.amount FROM public.bank_entry be
     WHERE be.other_ledger_id = (SELECT id FROM c) AND be.direction='out'
    UNION ALL
    SELECT be.entry_date, -be.amount FROM public.bank_entry be
     WHERE be.bank_ledger_id = (SELECT id FROM c) AND be.direction='out'
    UNION ALL
    SELECT w.pay_date, -w.amount FROM public.wage_entry w
     WHERE w.source_ledger_id = (SELECT id FROM c)
    UNION ALL
    SELECT e.pay_date, -e.amount FROM public.expense_entry e
     WHERE e.source_ledger_id = (SELECT id FROM c)
    UNION ALL
    SELECT el.loan_date, -el.amount FROM public.employee_loan el
     WHERE el.source_ledger_id = (SELECT id FROM c)
  )
  SELECT
    ROUND((CASE WHEN (SELECT opening_dr_cr FROM c) = 'Cr'
                THEN -(SELECT opening_amount FROM c)
                ELSE  (SELECT opening_amount FROM c) END
           + COALESCE(SUM(amt) FILTER (WHERE d <= p_as_of), 0))::numeric, 2),
    ROUND(COALESCE(SUM(amt) FILTER (WHERE d = p_as_of AND amt > 0), 0)::numeric, 2),
    ROUND(COALESCE(-SUM(amt) FILTER (WHERE d = p_as_of AND amt < 0), 0)::numeric, 2),
    p_as_of
  FROM mv;
$function$;
