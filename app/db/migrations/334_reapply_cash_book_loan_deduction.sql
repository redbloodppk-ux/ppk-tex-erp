-- 334: Re-apply 332 — cash goes down by (wage - loan instalment).
--
-- PPK, 2026-11-04: "loan amount was deducted in their wages and paid 3,550
-- for viji" — the worker gets the wage LESS the instalment in hand, so only
-- that leaves the drawer. 333 had reverted 332 because the full-amount
-- figure happened to match the drawer; that match hid ~Rs 13,500 of cash
-- spending never entered (Jul–Nov). PPK chose to close the gap with ONE
-- dated adjustment expense (04-11-2026, "Cash difference – not entered
-- (Jul–Nov)") rather than altering the 01-04-2026 opening cash.

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
           -(w.amount - COALESCE(w.loan_deduction, 0)), 'wage_entry', w.id
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
