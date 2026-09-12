-- ============================================================================
-- 295: The daily cash book — and the rule it shares with the dashboard.
--
-- PPK, 2026-09-12: "we need daily cashbook register in reports."
--
-- ONE RULE, NOT TWO
-- Migration 294 put the definition of "a cash movement" inside
-- fn_cash_in_hand, where only a total could come out of it. A cash book
-- needs the same movements itemised. Copying the six-table UNION into a
-- second function would guarantee the two drift apart the first time a
-- source is added.
--
-- So the union moves into fn_cash_movements, which lists them, and
-- fn_cash_in_hand is rewritten to add up what that returns. The cash book
-- and the dashboard card now cannot disagree: they are the same rows.
--
-- WHAT CHANGED IN THE RULE ITSELF
-- Enumerating the movements for display exposed four bank_entry rows that
-- 294 was not counting. It handled direction='out' on both sides of a bank
-- entry but never direction='in', so cash RECEIVED through the bank-entry
-- screen was invisible:
--
--   BE/26-27/0056  12-Jun      2,600  SCRAP          cash in
--   BE/26-27/0055  16-Jun      7,000  RENTAL INCOME  cash in
--   BE/26-27/0061  15-Jul  2,01,450  KONGU CHIT     cash in
--   BE/26-27/0065  25-Jul      1,550  CASH -> CASH   (both sides cash)
--
-- That is Rs 2,11,050 of receipts the running balance never saw. They are
-- counted now. The last one names CASH on both sides, which cannot be a
-- real movement; counted on both sides it nets to zero, which is the
-- correct treatment of a row that moves money from the drawer to itself.
--
-- CONSEQUENCE, STATED PLAINLY: with these four included the balance at
-- 12-Sep-2026 reads Rs 2,76,290, not the Rs 76,240 PPK counted in the
-- drawer. The opening of Rs 47,141 set by migration 293 was solved
-- backwards from the counted figure using the incomplete rule, so it
-- absorbed the error. Working back with the complete rule gives an opening
-- of minus Rs 1,52,909, which is impossible for cash in hand.
--
-- The gap is therefore real and predates this migration. It is left
-- showing rather than tuned away: the arithmetic here is right, and which
-- of those four receipts actually reached the drawer is PPK's to say. The
-- opening is not touched until he does.
--
-- SIGNS: positive is money into the drawer.
--   payment            direction in / out
--   bank_entry         other side is cash + out   -> withdrawn into cash
--                      cash side is bank + out    -> cash paid out
--                      cash side is bank + in     -> cash received
--                      other side is cash + in    -> cash paid into a bank
--   wage_entry         always out
--   expense_entry      always out
--   employee_loan      always out
--
-- Cancelled rows are excluded wherever the table carries a status
-- (payment, bank_entry). wage_entry, expense_entry and employee_loan have
-- no status column - a deleted row is gone, not flagged.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- fn_cash_movements: every movement through the cash drawer, itemised.
-- p_from NULL means "from the beginning".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cash_movements(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  entry_date  date,
  entered_at  timestamptz,
  voucher     text,
  particulars text,
  amount      numeric,   -- signed: + into the drawer, - out of it
  ref_kind    text,
  ref_id      bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH c AS (
    SELECT id FROM public.ledger
     WHERE name = 'CASH'
       AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH')
     LIMIT 1
  ),
  mv AS (
    -- Cash received from or paid to a party
    SELECT p.payment_date, p.created_at, p.payment_no,
           CASE WHEN p.direction = 'in' THEN 'Received — ' ELSE 'Paid — ' END
             || COALESCE(pt.name, 'party'),
           CASE WHEN p.direction = 'in' THEN p.amount ELSE -p.amount END,
           'payment', p.id
      FROM public.payment p
      LEFT JOIN public.party pt ON pt.id = p.party_id
     WHERE p.mode_ledger_id = (SELECT id FROM c)
       AND p.status = 'active'

    UNION ALL
    -- Withdrawn from a bank into the drawer
    SELECT be.entry_date, be.created_at, be.entry_no,
           'Withdrawn from ' || COALESCE(lb.name, 'bank'),
           be.amount, 'bank_entry', be.id
      FROM public.bank_entry be
      LEFT JOIN public.ledger lb ON lb.id = be.bank_ledger_id
     WHERE be.other_ledger_id = (SELECT id FROM c)
       AND be.direction = 'out' AND be.status = 'active'

    UNION ALL
    -- Cash paid out through the bank-entry screen
    SELECT be.entry_date, be.created_at, be.entry_no,
           'Paid — ' || COALESCE(lo.name, 'account'),
           -be.amount, 'bank_entry', be.id
      FROM public.bank_entry be
      LEFT JOIN public.ledger lo ON lo.id = be.other_ledger_id
     WHERE be.bank_ledger_id = (SELECT id FROM c)
       AND be.direction = 'out' AND be.status = 'active'

    UNION ALL
    -- Cash received through the bank-entry screen
    SELECT be.entry_date, be.created_at, be.entry_no,
           'Received — ' || COALESCE(lo.name, 'account'),
           be.amount, 'bank_entry', be.id
      FROM public.bank_entry be
      LEFT JOIN public.ledger lo ON lo.id = be.other_ledger_id
     WHERE be.bank_ledger_id = (SELECT id FROM c)
       AND be.direction = 'in' AND be.status = 'active'

    UNION ALL
    -- Cash paid into a bank
    SELECT be.entry_date, be.created_at, be.entry_no,
           'Deposited to ' || COALESCE(lb.name, 'bank'),
           -be.amount, 'bank_entry', be.id
      FROM public.bank_entry be
      LEFT JOIN public.ledger lb ON lb.id = be.bank_ledger_id
     WHERE be.other_ledger_id = (SELECT id FROM c)
       AND be.direction = 'in' AND be.status = 'active'

    UNION ALL
    -- Wages paid in cash
    SELECT w.pay_date, w.created_at, 'WAGE-' || w.id,
           'Wages — ' || COALESCE(e.full_name, 'employee'),
           -w.amount, 'wage_entry', w.id
      FROM public.wage_entry w
      LEFT JOIN public.employee e ON e.id = w.employee_id
     WHERE w.source_ledger_id = (SELECT id FROM c)

    UNION ALL
    -- Expenses paid in cash
    SELECT x.pay_date, x.created_at, 'EXP-' || x.id,
           'Expense — ' || COALESCE(NULLIF(x.category, ''), 'general'),
           -x.amount, 'expense_entry', x.id
      FROM public.expense_entry x
     WHERE x.source_ledger_id = (SELECT id FROM c)

    UNION ALL
    -- Advances given in cash
    SELECT el.loan_date, el.created_at, 'ADV-' || el.id,
           'Advance — ' || COALESCE(e.full_name, 'employee'),
           -el.amount, 'employee_loan', el.id
      FROM public.employee_loan el
      LEFT JOIN public.employee e ON e.id = el.employee_id
     WHERE el.source_ledger_id = (SELECT id FROM c)
  )
  SELECT * FROM mv AS m(entry_date, entered_at, voucher, particulars, amount, ref_kind, ref_id)
   WHERE (p_from IS NULL OR m.entry_date >= p_from)
     AND m.entry_date <= p_to
   ORDER BY m.entry_date, m.entered_at, m.voucher;
$$;

COMMENT ON FUNCTION public.fn_cash_movements(date, date) IS
  'Every movement through the cash drawer, itemised and signed (+ in, - out). The single definition of what counts as cash; fn_cash_in_hand and the cash book both read it. See migration 295.';

-- ----------------------------------------------------------------------------
-- fn_cash_in_hand: unchanged signature, now adding up fn_cash_movements
-- instead of carrying its own copy of the union.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cash_in_hand(p_as_of date DEFAULT CURRENT_DATE)
RETURNS TABLE (balance numeric, day_in numeric, day_out numeric, as_of date)
LANGUAGE sql
STABLE
AS $$
  WITH c AS (
    SELECT opening_amount, opening_dr_cr FROM public.ledger
     WHERE name = 'CASH'
       AND type_id = (SELECT id FROM public.ledger_type WHERE name = 'CASH')
     LIMIT 1
  ),
  mv AS (SELECT * FROM public.fn_cash_movements(NULL, p_as_of))
  SELECT
    ROUND((CASE WHEN (SELECT opening_dr_cr FROM c) = 'Cr'
                THEN -(SELECT opening_amount FROM c)
                ELSE  (SELECT opening_amount FROM c) END
           + COALESCE(SUM(mv.amount), 0))::numeric, 2),
    ROUND(COALESCE(SUM(mv.amount) FILTER (WHERE mv.entry_date = p_as_of AND mv.amount > 0), 0)::numeric, 2),
    ROUND(COALESCE(-SUM(mv.amount) FILTER (WHERE mv.entry_date = p_as_of AND mv.amount < 0), 0)::numeric, 2),
    p_as_of
  FROM mv;
$$;

COMMENT ON FUNCTION public.fn_cash_in_hand(date) IS
  'Cash in the drawer as of a date, plus that day''s in and out. Adds up fn_cash_movements so it can never disagree with the cash book. See migrations 293, 294, 295.';

-- ----------------------------------------------------------------------------
-- fn_cash_book_day: one day's register, with the running balance already
-- worked out. Row 0 is the opening brought forward.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_cash_book_day(p_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (
  seq         int,
  voucher     text,
  particulars text,
  cash_in     numeric,
  cash_out    numeric,
  running     numeric,
  ref_kind    text,
  ref_id      bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH opening AS (
    -- The close of the previous day, from the same function the dashboard
    -- card uses. Not recomputed here.
    SELECT balance AS amt FROM public.fn_cash_in_hand(p_date - 1)
  ),
  rows AS (
    SELECT ROW_NUMBER() OVER (ORDER BY m.entered_at, m.voucher)::int AS n,
           m.voucher, m.particulars, m.amount, m.ref_kind, m.ref_id
      FROM public.fn_cash_movements(p_date, p_date) m
  )
  SELECT 0, NULL::text, 'Opening balance',
         NULL::numeric, NULL::numeric,
         ROUND((SELECT amt FROM opening), 2),
         'opening', NULL::bigint
  UNION ALL
  SELECT r.n, r.voucher, r.particulars,
         CASE WHEN r.amount > 0 THEN  r.amount END,
         CASE WHEN r.amount < 0 THEN -r.amount END,
         ROUND((SELECT amt FROM opening)
               + SUM(r.amount) OVER (ORDER BY r.n ROWS UNBOUNDED PRECEDING), 2),
         r.ref_kind, r.ref_id
    FROM rows r
  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.fn_cash_book_day(date) IS
  'One day of the cash book: opening brought forward as row 0, then each movement with its running balance. See migration 295.';

-- Verify:
--   select * from fn_cash_book_day(DATE '2026-09-11');
--   -- the last row's running balance must equal
--   select balance from fn_cash_in_hand(DATE '2026-09-11');
