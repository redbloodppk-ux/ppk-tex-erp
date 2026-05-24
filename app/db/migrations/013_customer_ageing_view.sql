-- 013_customer_ageing_view.sql
-- Outstanding receivables per customer, bucketed by invoice age:
--   0-30 / 31-60 / 61-90 / 90+ days from invoice_date.
-- Credit notes net out (signed negative).
-- Excludes draft/cancelled/paid invoices. Uses payment.direction='in' for
-- last_payment_date.

DROP VIEW IF EXISTS v_customer_ageing CASCADE;

CREATE VIEW v_customer_ageing
WITH (security_invoker = on)
AS
WITH open_invoices AS (
  SELECT
    i.customer_id,
    i.id              AS invoice_id,
    i.invoice_date,
    i.due_date,
    i.doc_type,
    CASE
      WHEN i.doc_type = 'credit_note' THEN -i.balance
      ELSE i.balance
    END AS signed_balance,
    (CURRENT_DATE - i.invoice_date)::integer AS age_days
  FROM invoice i
  WHERE i.status NOT IN ('draft', 'cancelled', 'paid')
    AND i.customer_id IS NOT NULL
    AND i.balance <> 0
),
bucketed AS (
  SELECT
    customer_id,
    SUM(CASE WHEN age_days BETWEEN 0 AND 30  THEN signed_balance ELSE 0 END) AS bucket_0_30,
    SUM(CASE WHEN age_days BETWEEN 31 AND 60 THEN signed_balance ELSE 0 END) AS bucket_31_60,
    SUM(CASE WHEN age_days BETWEEN 61 AND 90 THEN signed_balance ELSE 0 END) AS bucket_61_90,
    SUM(CASE WHEN age_days > 90              THEN signed_balance ELSE 0 END) AS bucket_90_plus,
    SUM(signed_balance) AS total_outstanding,
    SUM(CASE
          WHEN CURRENT_DATE > COALESCE(due_date, invoice_date + 30)
          THEN signed_balance
          ELSE 0
        END) AS overdue_amount,
    MAX(invoice_date)            AS last_invoice_date,
    COUNT(*)                     AS open_invoice_count,
    MAX(age_days)                AS oldest_age_days
  FROM open_invoices
  GROUP BY customer_id
),
last_pmt AS (
  SELECT customer_id, MAX(payment_date) AS last_payment_date
  FROM payment
  WHERE direction = 'in' AND customer_id IS NOT NULL
  GROUP BY customer_id
)
SELECT
  c.id                                  AS customer_id,
  c.code,
  c.name,
  c.city,
  c.state,
  c.is_vip,
  c.payment_terms_days,
  c.credit_limit,
  c.status                              AS customer_status,
  COALESCE(b.bucket_0_30,    0)::numeric(14,2) AS bucket_0_30,
  COALESCE(b.bucket_31_60,   0)::numeric(14,2) AS bucket_31_60,
  COALESCE(b.bucket_61_90,   0)::numeric(14,2) AS bucket_61_90,
  COALESCE(b.bucket_90_plus, 0)::numeric(14,2) AS bucket_90_plus,
  COALESCE(b.total_outstanding, 0)::numeric(14,2) AS total_outstanding,
  COALESCE(b.overdue_amount,    0)::numeric(14,2) AS overdue_amount,
  COALESCE(b.open_invoice_count, 0)::integer     AS open_invoice_count,
  b.oldest_age_days,
  b.last_invoice_date,
  lp.last_payment_date,
  CASE
    WHEN c.credit_limit IS NOT NULL AND c.credit_limit > 0
         AND COALESCE(b.total_outstanding, 0) > c.credit_limit
    THEN true
    ELSE false
  END AS over_credit_limit
FROM customer c
LEFT JOIN bucketed b ON b.customer_id = c.id
LEFT JOIN last_pmt  lp ON lp.customer_id = c.id
WHERE c.status = 'active' OR COALESCE(b.total_outstanding, 0) <> 0;

COMMENT ON VIEW v_customer_ageing IS
  'Customer ageing — outstanding receivables bucketed 0-30/31-60/61-90/90+ from invoice_date. Credit notes net out.';
