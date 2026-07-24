-- 242_customer_outstanding_credit_note_sign.sql
-- v_customer_outstanding was summing invoice.balance across all doc_types
-- with no sign handling, so credit_note rows ADDED to a customer's
-- outstanding/overdue totals instead of reducing them (same class of bug
-- fixed on the party-statement print page and already handled correctly
-- in v_customer_ageing — see 013_customer_ageing_view.sql).
--
-- This dashboard KPI ("Outstanding Receivable") is the most visible place
-- this bug reaches, so we fix the view here using the same
-- "sign once in a base CTE" convention as v_customer_ageing.

DROP VIEW IF EXISTS v_customer_outstanding CASCADE;

CREATE VIEW v_customer_outstanding
WITH (security_invoker = on)
AS
WITH signed AS (
  SELECT
    i.customer_id,
    i.status,
    i.due_date,
    CASE
      WHEN i.doc_type = 'credit_note' THEN -i.balance
      ELSE i.balance
    END AS signed_balance,
    i.invoice_date
  FROM invoice i
  WHERE i.customer_id IS NOT NULL
)
SELECT
  c.id AS customer_id, c.code, c.name,
  COALESCE(SUM(s.signed_balance) FILTER (WHERE s.status NOT IN ('paid','cancelled')), 0) AS outstanding,
  COALESCE(SUM(s.signed_balance) FILTER (WHERE s.status NOT IN ('paid','cancelled') AND s.due_date < CURRENT_DATE), 0) AS overdue,
  MAX(s.invoice_date) AS last_invoice_date
FROM customer c
LEFT JOIN signed s ON s.customer_id = c.id
GROUP BY c.id, c.code, c.name;

COMMENT ON VIEW v_customer_outstanding IS
  'Per-customer outstanding + overdue receivable, driving the dashboard KPI card. Credit notes net out (signed negative), matching v_customer_ageing.';
