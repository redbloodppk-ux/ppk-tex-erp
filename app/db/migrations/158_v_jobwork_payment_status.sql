-- 158_v_jobwork_payment_status.sql
--
-- Per-jobwork-party snapshot for the dashboard "Outstanding Jobwork
-- Payments" widget. The schema doesn't have a per-receipt charges
-- table yet, so we can't compute exact rupee outstanding. Instead the
-- view exposes the data points the operator uses to mentally track
-- balance with each weaver:
--
--   metres_received_ytd     fabric received from the party so far
--                           this financial year (Apr 1 onwards)
--   payments_out_ytd        sum of payments made to the party so
--                           far this financial year
--   last_receipt_date       latest fabric_receipt date
--   last_payment_date       latest outbound payment date
--   days_since_last_payment NULL if never paid, else
--                           current_date - last_payment_date
--
-- The dashboard widget orders by days_since_last_payment DESC NULLS
-- FIRST so jobworkers waiting longest float to the top.

CREATE OR REPLACE VIEW public.v_jobwork_payment_status AS
WITH fy_start AS (
  SELECT CASE
    WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4
      THEN make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int,     4, 1)
      ELSE make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int - 1, 4, 1)
  END AS d
),
jobwork_parties AS (
  SELECT p.id, p.code, p.name
  FROM public.party p
  WHERE p.status = 'active'
    AND p.party_type_ids @> ARRAY[3::bigint]
),
receipts AS (
  SELECT dc.party_id,
         SUM(fri.received_metres) FILTER (WHERE fr.receipt_date >= (SELECT d FROM fy_start))::numeric AS metres_ytd,
         MAX(fr.receipt_date) AS last_receipt_date
  FROM public.fabric_receipt fr
  JOIN public.fabric_receipt_item fri ON fri.receipt_id = fr.id
  JOIN public.delivery_challan dc ON dc.id = fr.dc_id
  WHERE dc.production_mode::text = 'jobwork'
  GROUP BY dc.party_id
),
payments_out AS (
  SELECT pay.party_id,
         SUM(pay.amount) FILTER (WHERE pay.payment_date >= (SELECT d FROM fy_start))::numeric AS paid_ytd,
         MAX(pay.payment_date) AS last_payment_date
  FROM public.payment pay
  WHERE pay.direction = 'out'
    AND pay.status::text NOT IN ('cancelled','void')
  GROUP BY pay.party_id
)
SELECT
  jp.id   AS party_id,
  jp.code AS party_code,
  jp.name AS party_name,
  COALESCE(r.metres_ytd, 0)::numeric(14,2)     AS metres_received_ytd,
  COALESCE(po.paid_ytd, 0)::numeric(14,2)      AS payments_out_ytd,
  r.last_receipt_date,
  po.last_payment_date,
  CASE WHEN po.last_payment_date IS NULL THEN NULL
       ELSE (CURRENT_DATE - po.last_payment_date) END AS days_since_last_payment,
  CASE WHEN r.last_receipt_date IS NULL THEN NULL
       ELSE (CURRENT_DATE - r.last_receipt_date) END  AS days_since_last_receipt
FROM jobwork_parties jp
LEFT JOIN receipts      r  ON r.party_id  = jp.id
LEFT JOIN payments_out  po ON po.party_id = jp.id;

COMMENT ON VIEW public.v_jobwork_payment_status IS
  'Per-jobwork-party YTD activity snapshot for the dashboard widget. '
  'metres / payments are summed from 1-April of the running financial year. '
  'days_since_last_payment is NULL when no payment has ever been made.';
