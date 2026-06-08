-- 134_cashflow_includes_bank_entries.sql
-- Cashflow Snapshot + Recent activity now include Bank Entries (mig
-- 131) alongside the payment table. Before this, only party payments
-- counted — EB bills, loan EMIs, cash withdrawals etc. were missing
-- from /app/reports/cashflow.

DROP VIEW IF EXISTS public.v_cashflow_snapshot CASCADE;
DROP VIEW IF EXISTS public.v_cashflow_recent   CASCADE;

CREATE VIEW public.v_cashflow_snapshot
WITH (security_invoker = on) AS
WITH
  flows AS (
    SELECT payment_date::date AS d, direction::text AS dir, amount FROM public.payment
    UNION ALL
    SELECT entry_date::date,    direction::text,     amount FROM public.bank_entry
     WHERE status = 'active'
  ),
  p AS (
    SELECT
      SUM(amount) FILTER (WHERE dir = 'in'  AND d >= CURRENT_DATE - 7 ) AS in_7d,
      SUM(amount) FILTER (WHERE dir = 'in'  AND d >= CURRENT_DATE - 30) AS in_30d,
      SUM(amount) FILTER (WHERE dir = 'in'  AND d >= CURRENT_DATE - 90) AS in_90d,
      SUM(amount) FILTER (WHERE dir = 'out' AND d >= CURRENT_DATE - 7 ) AS out_7d,
      SUM(amount) FILTER (WHERE dir = 'out' AND d >= CURRENT_DATE - 30) AS out_30d,
      SUM(amount) FILTER (WHERE dir = 'out' AND d >= CURRENT_DATE - 90) AS out_90d,
      COUNT(*)    FILTER (WHERE dir = 'in'  AND d >= CURRENT_DATE - 30) AS in_count_30d,
      COUNT(*)    FILTER (WHERE dir = 'out' AND d >= CURRENT_DATE - 30) AS out_count_30d,
      MAX(d)                                                            AS last_payment_date
    FROM flows
  ),
  upc AS (
    SELECT
      SUM(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
        FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)  AS in_due_7d,
      SUM(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
        FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS in_due_30d,
      SUM(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
        FILTER (WHERE COALESCE(due_date, invoice_date + 30) <  CURRENT_DATE)                            AS in_overdue,
      SUM(CASE WHEN ledger_id IS NOT NULL THEN balance ELSE 0 END)
        FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)  AS out_due_7d,
      SUM(CASE WHEN ledger_id IS NOT NULL THEN balance ELSE 0 END)
        FILTER (WHERE COALESCE(due_date, invoice_date + 30) BETWEEN CURRENT_DATE AND CURRENT_DATE + 30) AS out_due_30d,
      SUM(CASE WHEN ledger_id IS NOT NULL THEN balance ELSE 0 END)
        FILTER (WHERE COALESCE(due_date, invoice_date + 30) <  CURRENT_DATE)                            AS out_overdue
    FROM public.invoice
    WHERE status NOT IN ('draft', 'cancelled', 'paid') AND balance > 0 AND doc_type <> 'credit_note'
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

CREATE VIEW public.v_cashflow_recent
WITH (security_invoker = on) AS
SELECT
  p.id AS source_id, 'payment'::text AS source_kind, p.payment_no AS doc_no, p.payment_date AS event_date,
  p.direction::text AS direction, p.amount::numeric(14,2) AS amount, p.mode::text AS mode, p.reference,
  COALESCE(c.name, l.name) AS party_name, COALESCE(c.code, l.code) AS party_code,
  CASE WHEN p.customer_id IS NOT NULL THEN 'customer'
       WHEN p.ledger_id   IS NOT NULL THEN 'vendor'
       WHEN p.mill_id     IS NOT NULL THEN 'mill'
       ELSE 'other' END AS party_kind,
  i.invoice_no, NULL::text AS category_code, NULL::text AS category_name,
  (CURRENT_DATE - p.payment_date)::integer AS days_ago
FROM public.payment p
LEFT JOIN public.customer c ON c.id = p.customer_id
LEFT JOIN public.ledger   l ON l.id = p.ledger_id
LEFT JOIN public.invoice  i ON i.id = p.invoice_id
WHERE p.payment_date >= CURRENT_DATE - 90

UNION ALL
SELECT
  be.id AS source_id, 'bank_entry'::text AS source_kind, be.entry_no AS doc_no, be.entry_date AS event_date,
  be.direction::text AS direction, be.amount::numeric(14,2) AS amount, be.mode::text AS mode, be.reference,
  bl.name AS party_name, bl.code AS party_code, 'bank'::text AS party_kind,
  NULL::text AS invoice_no, bc.code AS category_code, bc.name AS category_name,
  (CURRENT_DATE - be.entry_date)::integer AS days_ago
FROM public.bank_entry be
JOIN public.bank_category bc ON bc.id = be.category_id
LEFT JOIN public.ledger   bl ON bl.id = be.bank_ledger_id
WHERE be.status = 'active' AND be.entry_date >= CURRENT_DATE - 90;

COMMENT ON VIEW public.v_cashflow_snapshot IS
  'Cashflow snapshot — 7/30/90 day in vs out, includes payments + bank entries.';
COMMENT ON VIEW public.v_cashflow_recent IS
  'Last 90 days of cash movement — payments (party-resolved) and bank entries (with category) in one feed.';
