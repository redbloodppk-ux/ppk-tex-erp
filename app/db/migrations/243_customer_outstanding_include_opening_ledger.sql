-- 243_customer_outstanding_include_opening_ledger.sql
-- v_customer_outstanding (dashboard "Outstanding Receivable" KPI card) was
-- invoice-only, so any customer with a pre-ERP opening-ledger balance
-- (party_opening_ledger, direction='receivable') showed a lower total on
-- the KPI card than on the Outstanding-tab per-party widget and the
-- printable party statement, both of which already include opening-ledger
-- balances (see mergeOpeningLedger in dashboard/page.tsx and the party
-- statement print page). This was surfaced by S R TEX: KPI showed
-- Rs 2,75,513 (invoices only) while the widget/PDF showed Rs 2,77,616
-- (invoices + an intentional Rs 2,103 opening-ledger entry).
--
-- This migration folds active receivable opening-ledger balances into the
-- view so all three surfaces agree. party_opening_ledger is keyed by
-- party_id, not customer_id -- there is no FK between the `party` and
-- `customer` tables. `customer.ledger_id` can link back to `party.ledger_id`
-- (see 096_party_to_customer_sync.sql), but 3 of 165 customers currently
-- have no ledger_id set, so we join by exact name match instead -- the same
-- convention already relied on elsewhere in the app (dashboard's
-- partyNameById lookup, the party statement print page) to reconcile the
-- two tables. Verified before applying: every customer row matches exactly
-- one party by name, and every active receivable opening-ledger row
-- matches a customer this way, so the join neither double-counts nor drops
-- any balance.
--
-- Opening-ledger rows carry invoice_date but no due_date column, so they
-- use the same invoice_date+30 overdue fallback as credit/debit notes
-- (see 242_customer_outstanding_credit_note_sign.sql) and are always
-- counted toward "outstanding" (there's no paid/cancelled status to
-- exclude them, unlike invoice rows).

DROP VIEW IF EXISTS v_customer_outstanding CASCADE;

CREATE VIEW v_customer_outstanding
WITH (security_invoker = on)
AS
WITH signed AS (
  SELECT
    i.customer_id,
    i.status::text AS status,
    COALESCE(i.due_date, i.invoice_date + 30) AS effective_due_date,
    CASE
      WHEN i.doc_type = 'credit_note' THEN -i.balance
      ELSE i.balance
    END AS signed_balance,
    i.invoice_date
  FROM invoice i
  WHERE i.customer_id IS NOT NULL
),
opening AS (
  SELECT
    c.id AS customer_id,
    ol.balance AS signed_balance,
    (ol.invoice_date + 30) AS effective_due_date
  FROM party_opening_ledger ol
  JOIN party p ON p.id = ol.party_id
  JOIN customer c ON c.name = p.name
  WHERE ol.status = 'active' AND ol.direction = 'receivable'
),
combined AS (
  SELECT customer_id, status, effective_due_date, signed_balance, invoice_date FROM signed
  UNION ALL
  SELECT customer_id, NULL::text AS status, effective_due_date, signed_balance, NULL::date AS invoice_date FROM opening
)
SELECT
  c.id AS customer_id, c.code, c.name,
  COALESCE(SUM(s.signed_balance) FILTER (WHERE s.status IS NULL OR s.status NOT IN ('paid','cancelled')), 0) AS outstanding,
  COALESCE(SUM(s.signed_balance) FILTER (WHERE (s.status IS NULL OR s.status NOT IN ('paid','cancelled')) AND s.effective_due_date < CURRENT_DATE), 0) AS overdue,
  MAX(s.invoice_date) AS last_invoice_date
FROM customer c
LEFT JOIN combined s ON s.customer_id = c.id
GROUP BY c.id, c.code, c.name;

COMMENT ON VIEW v_customer_outstanding IS
  'Per-customer outstanding + overdue receivable, driving the dashboard KPI card. Includes invoices (credit notes signed negative) plus active receivable party_opening_ledger balances, joined to customer by exact name match. Overdue falls back to invoice_date+30 when due_date is null (credit/debit notes and opening-ledger rows carry no due_date), matching v_customer_ageing.';
