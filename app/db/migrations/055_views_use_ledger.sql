-- 055_views_use_ledger.sql
--
-- Pre-cutover step before dropping the vendor table. Rebuilds every view
-- that previously joined vendor so it now joins the ledger master via
-- the parallel *_ledger_id columns added in migration 053.
--
-- Touched: v_sizing_spend_by_vendor, v_cashflow_recent,
--          v_cashflow_snapshot, v_production_batch_with_source.
-- Output column names that downstream code reads (e.g. vendor_name,
-- vendor_id, outsource_vendor_id) are kept for compatibility so report
-- consumers don't need to change.

BEGIN;

CREATE OR REPLACE VIEW public.v_sizing_spend_by_vendor AS
WITH scoped AS (
  SELECT sj.id, sj.sizing_ledger_id, sj.yarn_used_kg, sj.total_amount,
    COALESCE(sj.date_received, sj.date_sent, (sj.created_at)::date) AS spend_date
  FROM public.sizing_job sj
  WHERE sj.status <> 'cancelled'::sizing_job_status AND sj.total_amount > 0
)
SELECT l.id AS vendor_id, l.code AS vendor_code, l.name AS vendor_name,
       (count(s.id))::integer AS jobs_count,
       (sum(s.yarn_used_kg))::numeric(14,3) AS total_yarn_kg,
       (sum(s.total_amount))::numeric(14,2) AS total_spend,
       CASE WHEN sum(s.yarn_used_kg) > 0
            THEN (sum(s.total_amount) / sum(s.yarn_used_kg))::numeric(10,4)
            ELSE NULL END AS effective_rate_per_kg,
       min(s.spend_date) AS first_job_date,
       max(s.spend_date) AS last_job_date
FROM scoped s
JOIN public.ledger l ON l.id = s.sizing_ledger_id
GROUP BY l.id, l.code, l.name
ORDER BY total_spend DESC;

CREATE OR REPLACE VIEW public.v_cashflow_recent AS
SELECT p.id AS payment_id, p.payment_no, p.payment_date, p.direction, p.amount,
       p.mode, p.reference,
       COALESCE(c.name, l.name) AS party_name,
       COALESCE(c.code, l.code) AS party_code,
       CASE
         WHEN p.customer_id IS NOT NULL THEN 'customer'
         WHEN p.ledger_id   IS NOT NULL THEN 'vendor'
         WHEN p.mill_id     IS NOT NULL THEN 'mill'
         ELSE 'other'
       END AS party_kind,
       i.invoice_no,
       (CURRENT_DATE - p.payment_date) AS days_ago
FROM public.payment p
LEFT JOIN public.customer c ON c.id = p.customer_id
LEFT JOIN public.ledger   l ON l.id = p.ledger_id
LEFT JOIN public.invoice  i ON i.id = p.invoice_id
WHERE p.payment_date >= (CURRENT_DATE - 90);

CREATE OR REPLACE VIEW public.v_cashflow_snapshot AS
WITH p AS (
  SELECT sum(payment.amount) FILTER (WHERE direction='in'  AND payment_date >= CURRENT_DATE-7)  AS in_7d,
         sum(payment.amount) FILTER (WHERE direction='in'  AND payment_date >= CURRENT_DATE-30) AS in_30d,
         sum(payment.amount) FILTER (WHERE direction='in'  AND payment_date >= CURRENT_DATE-90) AS in_90d,
         sum(payment.amount) FILTER (WHERE direction='out' AND payment_date >= CURRENT_DATE-7)  AS out_7d,
         sum(payment.amount) FILTER (WHERE direction='out' AND payment_date >= CURRENT_DATE-30) AS out_30d,
         sum(payment.amount) FILTER (WHERE direction='out' AND payment_date >= CURRENT_DATE-90) AS out_90d,
         count(*) FILTER (WHERE direction='in'  AND payment_date >= CURRENT_DATE-30) AS in_count_30d,
         count(*) FILTER (WHERE direction='out' AND payment_date >= CURRENT_DATE-30) AS out_count_30d,
         max(payment_date) AS last_payment_date
  FROM public.payment
),
upc AS (
  SELECT sum(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
           FILTER (WHERE COALESCE(due_date, invoice_date + 30) >= CURRENT_DATE AND COALESCE(due_date, invoice_date + 30) <= CURRENT_DATE+7)  AS in_due_7d,
         sum(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
           FILTER (WHERE COALESCE(due_date, invoice_date + 30) >= CURRENT_DATE AND COALESCE(due_date, invoice_date + 30) <= CURRENT_DATE+30) AS in_due_30d,
         sum(CASE WHEN customer_id IS NOT NULL THEN balance ELSE 0 END)
           FILTER (WHERE COALESCE(due_date, invoice_date + 30) <  CURRENT_DATE) AS in_overdue,
         sum(CASE WHEN ledger_id   IS NOT NULL THEN balance ELSE 0 END)
           FILTER (WHERE COALESCE(due_date, invoice_date + 30) >= CURRENT_DATE AND COALESCE(due_date, invoice_date + 30) <= CURRENT_DATE+7)  AS out_due_7d,
         sum(CASE WHEN ledger_id   IS NOT NULL THEN balance ELSE 0 END)
           FILTER (WHERE COALESCE(due_date, invoice_date + 30) >= CURRENT_DATE AND COALESCE(due_date, invoice_date + 30) <= CURRENT_DATE+30) AS out_due_30d,
         sum(CASE WHEN ledger_id   IS NOT NULL THEN balance ELSE 0 END)
           FILTER (WHERE COALESCE(due_date, invoice_date + 30) <  CURRENT_DATE) AS out_overdue
  FROM public.invoice
  WHERE status NOT IN ('draft','cancelled','paid') AND balance > 0 AND doc_type <> 'credit_note'
)
SELECT (COALESCE(p.in_7d, 0))::numeric(14,2)  AS in_7d,
       (COALESCE(p.in_30d, 0))::numeric(14,2) AS in_30d,
       (COALESCE(p.in_90d, 0))::numeric(14,2) AS in_90d,
       (COALESCE(p.out_7d, 0))::numeric(14,2) AS out_7d,
       (COALESCE(p.out_30d, 0))::numeric(14,2) AS out_30d,
       (COALESCE(p.out_90d, 0))::numeric(14,2) AS out_90d,
       ((COALESCE(p.in_7d, 0)  - COALESCE(p.out_7d, 0)))::numeric(14,2)  AS net_7d,
       ((COALESCE(p.in_30d, 0) - COALESCE(p.out_30d, 0)))::numeric(14,2) AS net_30d,
       ((COALESCE(p.in_90d, 0) - COALESCE(p.out_90d, 0)))::numeric(14,2) AS net_90d,
       (COALESCE(p.in_count_30d, 0))::integer  AS in_count_30d,
       (COALESCE(p.out_count_30d, 0))::integer AS out_count_30d,
       p.last_payment_date,
       (COALESCE(u.in_due_7d, 0))::numeric(14,2)  AS in_due_7d,
       (COALESCE(u.in_due_30d, 0))::numeric(14,2) AS in_due_30d,
       (COALESCE(u.in_overdue, 0))::numeric(14,2) AS in_overdue,
       (COALESCE(u.out_due_7d, 0))::numeric(14,2)  AS out_due_7d,
       (COALESCE(u.out_due_30d, 0))::numeric(14,2) AS out_due_30d,
       (COALESCE(u.out_overdue, 0))::numeric(14,2) AS out_overdue,
       ((COALESCE(u.in_due_7d, 0)  - COALESCE(u.out_due_7d, 0)))::numeric(14,2)  AS net_due_7d,
       ((COALESCE(u.in_due_30d, 0) - COALESCE(u.out_due_30d, 0)))::numeric(14,2) AS net_due_30d
FROM p, upc u;

CREATE OR REPLACE VIEW public.v_production_batch_with_source AS
SELECT b.*,
       CASE WHEN b.outsource_order_id IS NOT NULL THEN 'outsource' ELSE 'inhouse' END AS source_kind,
       ow.ow_number,
       ow.ledger_id AS outsource_vendor_id,
       l.name AS outsource_vendor_name
FROM public.production_batch b
LEFT JOIN public.outsource_order ow ON ow.id = b.outsource_order_id
LEFT JOIN public.ledger l           ON l.id = ow.ledger_id;

COMMIT;
