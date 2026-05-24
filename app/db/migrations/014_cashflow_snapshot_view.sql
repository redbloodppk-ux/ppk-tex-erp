-- 014_cashflow_snapshot_view.sql
-- Cash-flow snapshot for owner dashboard.
--
-- Two views:
--   v_cashflow_snapshot  — single-row aggregate: in / out / net for 7d, 30d, 90d
--                          plus upcoming receivables and payables (next 7d / 30d)
--                          and overdue totals on both sides.
--   v_cashflow_recent    — last-90-day payment ledger, party-resolved, for
--                          a recent-activity table on the page.
--
-- Logic:
--   - "in"  = payment.direction='in' (customer payments received).
--   - "out" = payment.direction='out' (vendor / mill payouts).
--   - Upcoming receivables: invoice rows with customer_id and balance > 0,
--     excluding draft / cancelled / paid and credit notes.
--   - Upcoming payables: invoice rows with vendor_id and balance > 0,
--     same exclusions.
--   - Due date defaults to invoice_date + 30 days when due_date is null.

DROP VIEW IF EXISTS v_cashflow_snapshot CASCADE;
DROP VIEW IF EXISTS v_cashflow_recent CASCADE;

CREATE VIEW v_cashflow_snapshot
WITH (security_invoker = on)
AS
WITH p AS (
  SELECT
    SUM(amount) FILTER (WHERE direction = 'in'  AND payment_date >= CURRENT_DATE - 7 ) AS in_7d,
    SUM(amount) FILTER (WHERE direction = 'in'  AND payment_date >= CURRENT_DATE - 30) AS in_30d,
    SUM(amount) FILTER (WHERE direction = 'in'  AND payment_date >= CURRENT_DATE - 90) AS in_90d,
    SUM(amount) FILTER (WHERE direction = 'out' AND payment_date >= CURRENT_DATE - 7 ) AS out_7d,
    SUM(amount) FILTER (WHERE direction = 'out' AND payment_date >= CURRENT_DATE - 30) AS out_30d,
    SUM(amount) FILTER (WHERE direction = 'out' AND payment_date >= CURRENT_DATE - 90) AS out_90d,
    COUNT(*) FILTER (WHERE direction = 'in'  AND payment_date >= CURRENT_DATE - 30) AS in_count_30d,
    COUNT(*) FILTER (WHERE direction = 'out' AND payment_date >= CURRENT_DATE - 30) AS out_count_30d,
    MAX(payment_date) AS last_payment_date
  FROM payment
),
upc AS (
  SELECT
    -- Receivables (we get paid)
    SUM(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
      FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)
      AS in_due_7d,
    SUM(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
      FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)
      AS in_due_30d,
    SUM(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
      FILTER (WHERE COALESCE(due_date, invoice_date + 30) <  CURRENT_DATE)
      AS in_overdue,
    -- Payables (we pay them)
    SUM(CASE WHEN vendor_id IS NOT NULL THEN balance ELSE 0 END)
      FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)
      AS out_due_7d,
    SUM(CASE WHEN vendor_id IS NOT NULL THEN balance ELSE 0 END)
      FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)
      AS out_due_30d,
    SUM(CASE WHEN vendor_id IS NOT NULL THEN balance ELSE 0 END)
      FILTER (WHERE COALESCE(due_date, invoice_date + 30) <  CURRENT_DATE)
      AS out_overdue
  FROM invoice
  WHERE status NOT IN ('draft', 'cancelled', 'paid')
    AND balance > 0
    AND doc_type <> 'credit_note'
)
SELECT
  COALESCE(p.in_7d,  0)::numeric(14,2) AS in_7d,
  COALESCE(p.in_30d, 0)::numeric(14,2) AS in_30d,
  COALESCE(p.in_90d, 0)::numeric(14,2) AS in_90d,
  COALESCE(p.out_7d, 0)::numeric(14,2) AS out_7d,
  COALESCE(p.out_30d,0)::numeric(14,2) AS out_30d,
  COALESCE(p.out_90d,0)::numeric(14,2) AS out_90d,
  (COALESCE(p.in_7d, 0)  - COALESCE(p.out_7d, 0))::numeric(14,2)  AS net_7d,
  (COALESCE(p.in_30d,0)  - COALESCE(p.out_30d,0))::numeric(14,2)  AS net_30d,
  (COALESCE(p.in_90d,0)  - COALESCE(p.out_90d,0))::numeric(14,2)  AS net_90d,
  COALESCE(p.in_count_30d,  0)::integer AS in_count_30d,
  COALESCE(p.out_count_30d, 0)::integer AS out_count_30d,
  p.last_payment_date,
  COALESCE(u.in_due_7d,   0)::numeric(14,2) AS in_due_7d,
  COALESCE(u.in_due_30d,  0)::numeric(14,2) AS in_due_30d,
  COALESCE(u.in_overdue,  0)::numeric(14,2) AS in_overdue,
  COALESCE(u.out_due_7d,  0)::numeric(14,2) AS out_due_7d,
  COALESCE(u.out_due_30d, 0)::numeric(14,2) AS out_due_30d,
  COALESCE(u.out_overdue, 0)::numeric(14,2) AS out_overdue,
  (COALESCE(u.in_due_7d, 0)  - COALESCE(u.out_due_7d, 0))::numeric(14,2)  AS net_due_7d,
  (COALESCE(u.in_due_30d, 0) - COALESCE(u.out_due_30d, 0))::numeric(14,2) AS net_due_30d
FROM p, upc u;

CREATE VIEW v_cashflow_recent
WITH (security_invoker = on)
AS
SELECT
  p.id                                                 AS payment_id,
  p.payment_no,
  p.payment_date,
  p.direction,
  p.amount::numeric(14,2)                              AS amount,
  p.mode,
  p.reference,
  COALESCE(c.name, v.name)                             AS party_name,
  COALESCE(c.code, v.code)                             AS party_code,
  CASE WHEN p.customer_id IS NOT NULL THEN 'customer'
       WHEN p.vendor_id   IS NOT NULL THEN 'vendor'
       WHEN p.mill_id     IS NOT NULL THEN 'mill'
       ELSE 'other' END                                AS party_kind,
  i.invoice_no,
  (CURRENT_DATE - p.payment_date)::integer             AS days_ago
FROM payment p
LEFT JOIN customer c ON c.id = p.customer_id
LEFT JOIN vendor   v ON v.id = p.vendor_id
LEFT JOIN invoice  i ON i.id = p.invoice_id
WHERE p.payment_date >= CURRENT_DATE - 90;

COMMENT ON VIEW v_cashflow_snapshot IS
  'Cash-flow snapshot - 7/30/90 day in vs out, plus upcoming dues both sides.';
COMMENT ON VIEW v_cashflow_recent IS
  'Last 90 days of payments with party name resolved.';
