-- 148_invoice_delivery_status_view.sql
--
-- v_invoice_delivery_status — Invoice Delivery Status report source.
-- The original migration 019 used delivery_challan.dc_no + customer_id
-- + status='issued', but the live DC schema is:
--   - code (not dc_no)
--   - party_id (not customer_id; customer info comes from invoice)
--   - status: draft / confirmed / invoiced / cancelled (no 'issued')
--
-- An "issued" DC for delivery-tracking purposes is one whose status is
-- confirmed OR invoiced (i.e. it actually left the gate).

DROP VIEW IF EXISTS public.v_invoice_delivery_status CASCADE;

CREATE VIEW public.v_invoice_delivery_status
WITH (security_invoker = on) AS
WITH invoiced AS (
  SELECT invoice_id, COALESCE(SUM(quantity), 0) AS invoiced_m
  FROM public.invoice_line
  GROUP BY invoice_id
),
delivered AS (
  SELECT
    invoice_id,
    COUNT(*)                        AS dc_count,
    COALESCE(SUM(total_metres), 0)  AS delivered_m,
    MAX(dc_date)                    AS last_dc_date
  FROM public.delivery_challan
  WHERE status IN ('confirmed', 'invoiced')
    AND invoice_id IS NOT NULL
  GROUP BY invoice_id
)
SELECT
  i.id                                             AS invoice_id,
  i.invoice_no,
  i.invoice_date,
  i.doc_type,
  i.status                                         AS invoice_status,
  i.customer_id,
  c.code                                           AS customer_code,
  c.name                                           AS customer_name,
  i.total                                          AS invoice_total,

  COALESCE(iv.invoiced_m, 0)::numeric(14,2)        AS invoiced_m,
  COALESCE(d.delivered_m, 0)::numeric(14,2)        AS delivered_m,
  GREATEST(COALESCE(iv.invoiced_m, 0) - COALESCE(d.delivered_m, 0), 0)::numeric(14,2)
                                                   AS undelivered_m,
  COALESCE(d.dc_count, 0)::integer                 AS dc_count,
  d.last_dc_date,

  CASE
    WHEN COALESCE(d.dc_count, 0) = 0
      THEN 'missing'
    WHEN COALESCE(d.delivered_m, 0) > COALESCE(iv.invoiced_m, 0) + 0.5
      THEN 'over'
    WHEN COALESCE(d.delivered_m, 0) >= COALESCE(iv.invoiced_m, 0) - 0.5
      THEN 'full'
    ELSE 'partial'
  END                                              AS delivery_status

FROM public.invoice i
LEFT JOIN public.customer c  ON c.id = i.customer_id
LEFT JOIN invoiced iv        ON iv.invoice_id = i.id
LEFT JOIN delivered d        ON d.invoice_id = i.id
WHERE i.doc_type IN ('tax_invoice','yarn_sale','general_sale')
  AND i.status NOT IN ('draft','cancelled');

COMMENT ON VIEW public.v_invoice_delivery_status IS
  'Invoice -> DC delivery report. Adapted to the live DC schema (code + party_id; status in confirmed/invoiced means an actual dispatch).';
