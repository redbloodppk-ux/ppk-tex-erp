-- 217_invoice_extra_charge.sql
-- Add an optional flat "Other Charges" field to invoices (used by the
-- job-work / weaving bill). The charge is added to the grand total AFTER
-- tax — it carries no GST of its own.
--
-- invoice.total already stores the rounded grand total, so the form folds
-- extra_charge into total on save. The only place that re-derives GST from
-- the total is v_purchase_register's weaving source, which computes
--   gst_amount = (total - round_off) - taxable.
-- To stop the non-taxable extra from inflating that GST figure, the view's
-- weaving round_off now also absorbs extra_charge (and the previously
-- ignored invoice.round_off), so (total - round_off) - taxable == real GST.

BEGIN;

-- 1. New optional flat charge column -----------------------------------------
ALTER TABLE public.invoice ADD COLUMN IF NOT EXISTS extra_charge numeric(14,2) NOT NULL DEFAULT 0;

-- 2. Rebuild v_purchase_register so the weaving source stays GST-correct ------
DROP VIEW IF EXISTS public.v_purchase_register;

CREATE VIEW public.v_purchase_register AS
WITH company AS (
  SELECT upper(COALESCE(company_profile.state, 'TAMIL NADU'::text)) AS state
  FROM company_profile
  LIMIT 1
), yarn AS (
  SELECT 'yarn'::text AS source, yl.id AS source_id, yl.received_date AS bill_date,
    yl.invoice_no AS bill_no, yl.supplier_party_id AS party_id,
    yl.received_kg::numeric(14,2) AS quantity, 'kg'::text AS qty_uom,
    COALESCE(yl.gst_pct, 0)::numeric(6,2) AS gst_pct,
    ROUND((yl.total_amount - COALESCE(yl.round_off, 0)) / (1 + COALESCE(yl.gst_pct, 0) / 100.0), 2)::numeric(14,2) AS taxable,
    yl.total_amount AS total, COALESCE(yl.round_off, 0)::numeric(14,2) AS round_off,
    COALESCE(yl.amount_paid, 0)::numeric(14,2) AS amount_paid, 'active'::text AS status,
    NULL::numeric(14,2) AS cgst_inv, NULL::numeric(14,2) AS sgst_inv,
    NULL::numeric(14,2) AS igst_inv, NULL::boolean AS is_interstate_inv
  FROM yarn_lot yl
  WHERE yl.total_amount IS NOT NULL AND yl.total_amount > 0
), bobbin AS (
  SELECT 'bobbin'::text AS source, bp.id AS source_id, bp.purchase_date AS bill_date,
    bp.invoice_no AS bill_no, b.supplier_party_id AS party_id,
    COALESCE(bp.pieces_purchased, 0)::numeric(14,2) AS quantity, 'pcs'::text AS qty_uom,
    0::numeric(6,2) AS gst_pct,
    (bp.total_amount - COALESCE(bp.round_off, 0))::numeric(14,2) AS taxable,
    bp.total_amount AS total, COALESCE(bp.round_off, 0)::numeric(14,2) AS round_off,
    COALESCE(bp.amount_paid, 0)::numeric(14,2) AS amount_paid, 'active'::text AS status,
    NULL::numeric(14,2) AS cgst_inv, NULL::numeric(14,2) AS sgst_inv,
    NULL::numeric(14,2) AS igst_inv, NULL::boolean AS is_interstate_inv
  FROM bobbin_purchase bp
  LEFT JOIN public.bobbin b ON b.id = bp.bobbin_id
  WHERE bp.total_amount IS NOT NULL AND bp.total_amount > 0
), sizing AS (
  SELECT 'sizing'::text AS source, sj.id AS source_id,
    COALESCE(sj.bill_date, sj.date_received, sj.date_sent) AS bill_date,
    COALESCE(sj.bill_no, sj.job_code) AS bill_no, sj.party_id,
    COALESCE(sj.yarn_sent_kg, 0)::numeric(14,2) AS quantity, 'kg'::text AS qty_uom,
    COALESCE(sj.gst_pct, 0)::numeric(6,2) AS gst_pct,
    COALESCE(sj.charges_amount, 0)::numeric(14,2) AS taxable,
    COALESCE(sj.total_amount, 0)::numeric(14,2) AS total,
    COALESCE(sj.round_off, 0)::numeric(14,2) AS round_off,
    COALESCE(sj.amount_paid, 0)::numeric(14,2) AS amount_paid, sj.status::text AS status,
    NULL::numeric(14,2) AS cgst_inv, NULL::numeric(14,2) AS sgst_inv,
    NULL::numeric(14,2) AS igst_inv, NULL::boolean AS is_interstate_inv
  FROM sizing_job sj
  WHERE COALESCE(sj.total_amount, 0) > 0 AND (sj.status::text <> ALL (ARRAY['draft'::text, 'cancelled'::text]))
), fabric AS (
  SELECT 'fabric'::text AS source, fp.id AS source_id, fp.received_date AS bill_date,
    fp.invoice_no AS bill_no, fp.supplier_party_id AS party_id,
    fp.received_metres::numeric(14,2) AS quantity, 'm'::text AS qty_uom,
    COALESCE(fp.gst_pct, 0)::numeric(6,2) AS gst_pct,
    ROUND((fp.total_amount - COALESCE(fp.round_off, 0)) / (1 + COALESCE(fp.gst_pct, 0) / 100.0), 2)::numeric(14,2) AS taxable,
    fp.total_amount AS total, COALESCE(fp.round_off, 0)::numeric(14,2) AS round_off,
    COALESCE(fp.amount_paid, 0)::numeric(14,2) AS amount_paid, fp.status::text AS status,
    NULL::numeric(14,2) AS cgst_inv, NULL::numeric(14,2) AS sgst_inv,
    NULL::numeric(14,2) AS igst_inv, NULL::boolean AS is_interstate_inv
  FROM fabric_purchase fp
  WHERE fp.total_amount IS NOT NULL AND fp.total_amount > 0 AND (fp.status::text <> ALL (ARRAY['archived'::text, 'inactive'::text]))
), general AS (
  SELECT 'general'::text AS source, gp.id AS source_id, gp.bill_date, gp.bill_no,
    gp.supplier_party_id AS party_id, NULL::numeric(14,2) AS quantity, ''::text AS qty_uom,
    COALESCE(gp.gst_pct, 0)::numeric(6,2) AS gst_pct,
    COALESCE(gp.taxable, 0)::numeric(14,2) AS taxable,
    COALESCE(gp.total, 0)::numeric(14,2) AS total,
    COALESCE(gp.round_off, 0)::numeric(14,2) AS round_off,
    COALESCE(gp.amount_paid, 0)::numeric(14,2) AS amount_paid, gp.status::text AS status,
    NULL::numeric(14,2) AS cgst_inv, NULL::numeric(14,2) AS sgst_inv,
    NULL::numeric(14,2) AS igst_inv, NULL::boolean AS is_interstate_inv
  FROM general_purchase gp
  WHERE COALESCE(gp.total, 0) > 0 AND (gp.status::text <> ALL (ARRAY['draft'::text, 'cancelled'::text]))
), weaving AS (
  SELECT 'outsource_weaving'::text AS source, inv.id AS source_id, inv.invoice_date AS bill_date,
    inv.invoice_no AS bill_no, inv.jobwork_party_id AS party_id,
    COALESCE((SELECT sum(il.quantity) FROM invoice_line il WHERE il.invoice_id = inv.id), 0)::numeric(14,2) AS quantity,
    'm'::text AS qty_uom, NULL::numeric(6,2) AS gst_pct,
    inv.taxable_value::numeric(14,2) AS taxable, inv.total,
    -- Fold the non-taxable extra charge (and any real round-off) into the
    -- register's round_off so (total - round_off) - taxable stays == GST.
    (COALESCE(inv.round_off, 0) + COALESCE(inv.extra_charge, 0))::numeric(14,2) AS round_off,
    COALESCE(inv.amount_paid, 0)::numeric(14,2) AS amount_paid, inv.status::text AS status,
    inv.cgst_amount::numeric(14,2) AS cgst_inv, inv.sgst_amount::numeric(14,2) AS sgst_inv,
    inv.igst_amount::numeric(14,2) AS igst_inv, inv.is_interstate AS is_interstate_inv
  FROM invoice inv
  WHERE inv.doc_type = 'weaving_bill'::invoice_doc_type AND (inv.status::text <> ALL (ARRAY['draft'::text, 'cancelled'::text]))
), all_sources AS (
  SELECT * FROM yarn
  UNION ALL SELECT * FROM bobbin
  UNION ALL SELECT * FROM sizing
  UNION ALL SELECT * FROM fabric
  UNION ALL SELECT * FROM general
  UNION ALL SELECT * FROM weaving
)
SELECT s.source, s.source_id, s.bill_date, s.bill_no, s.party_id,
  COALESCE(p.code, ''::text) AS party_code,
  COALESCE(p.name, '—'::text) AS party_name,
  p.gstin AS party_gstin, p.state AS party_state,
  s.quantity, s.qty_uom, COALESCE(s.gst_pct, 0) AS gst_pct,
  s.taxable,
  GREATEST((s.total - s.round_off) - s.taxable, 0)::numeric(14,2) AS gst_amount,
  s.total, s.round_off, s.amount_paid,
  (s.total - s.amount_paid)::numeric(14,2) AS balance,
  s.status,
  CASE
    WHEN s.is_interstate_inv IS NOT NULL THEN s.is_interstate_inv
    WHEN p.state IS NULL THEN false
    ELSE upper(p.state) <> c.state
  END AS is_interstate,
  CASE
    WHEN s.cgst_inv IS NOT NULL THEN s.cgst_inv
    WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN 0::numeric
    ELSE round(GREATEST((s.total - s.round_off) - s.taxable, 0) / 2.0, 2)
  END::numeric(14,2) AS cgst_amount,
  CASE
    WHEN s.sgst_inv IS NOT NULL THEN s.sgst_inv
    WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN 0::numeric
    ELSE round(GREATEST((s.total - s.round_off) - s.taxable, 0) / 2.0, 2)
  END::numeric(14,2) AS sgst_amount,
  CASE
    WHEN s.igst_inv IS NOT NULL THEN s.igst_inv
    WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN GREATEST((s.total - s.round_off) - s.taxable, 0)
    ELSE 0::numeric
  END::numeric(14,2) AS igst_amount,
  CASE
    WHEN COALESCE(s.gst_pct, 0) > 0 OR s.cgst_inv IS NOT NULL OR s.sgst_inv IS NOT NULL OR s.igst_inv IS NOT NULL OR (s.total - s.round_off) > s.taxable THEN 'with_gst'::text
    ELSE 'without_gst'::text
  END AS gst_flag
FROM all_sources s
CROSS JOIN company c
LEFT JOIN party p ON p.id = s.party_id
WHERE s.bill_date IS NOT NULL;

COMMIT;
