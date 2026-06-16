-- 175_purchase_register_view.sql
--
-- Mirror of v_sales_register but on the BUY side. Unions every doc
-- type that records a supplier bill we owe / paid:
--   • yarn_lot              (yarn supplier invoices)
--   • bobbin_purchase       (bobbin supplier invoices)
--   • sizing_job            (sizing vendor charges)
--   • fabric_purchase       (resale fabric supplier invoices)
--   • invoice (doc_type IN 'weaving_bill','jobwork_invoice')
--                          (outsource weaver / in-house jobwork bills)
--
-- Sales Register has clean CGST/SGST/IGST split because the invoice
-- table already stores them per-row. Most of our purchase sources only
-- carry a single `gst_pct` field — for those we DERIVE the split here:
--   intrastate  → cgst = sgst = gst_amount / 2,  igst = 0
--   interstate  → cgst = sgst = 0,               igst = gst_amount
--
-- Interstate is decided by comparing the supplier's `party.state`
-- against the company's own state (from `company_profile`). When the
-- supplier has no party row (e.g. bobbin_purchase whose vendor isn't
-- linked yet) we fall back to "intrastate" so totals don't explode.
--
-- A row also carries a `gst_flag` column ('with_gst' | 'without_gst')
-- so the report can offer a quick filter — cash purchases / unregistered
-- suppliers usually come without GST.
--
-- Idempotent: DROP + CREATE inside one transaction.
--

BEGIN;

DROP VIEW IF EXISTS public.v_purchase_register CASCADE;

CREATE VIEW public.v_purchase_register
WITH (security_invoker=on) AS
WITH company AS (
  SELECT
    upper(coalesce(state, 'TAMIL NADU')) AS state
  FROM public.company_profile
  LIMIT 1
),
-- A) Yarn purchases (yarn_lot)
yarn AS (
  SELECT
    'yarn'::text                     AS source,
    yl.id                            AS source_id,
    yl.received_date                 AS bill_date,
    yl.invoice_no                    AS bill_no,
    yl.supplier_party_id             AS party_id,
    yl.received_kg::numeric(14,2)    AS quantity,
    'kg'::text                       AS qty_uom,
    COALESCE(yl.gst_pct, 0)::numeric(6,2) AS gst_pct,
    /* total includes GST → derive taxable from it */
    ROUND(
      yl.total_amount / (1 + COALESCE(yl.gst_pct, 0) / 100.0), 2
    )::numeric(14,2)                 AS taxable,
    yl.total_amount::numeric(14,2)   AS total,
    COALESCE(yl.amount_paid, 0)::numeric(14,2) AS amount_paid,
    'active'::text                   AS status,
    NULL::numeric(14,2)              AS cgst_inv,
    NULL::numeric(14,2)              AS sgst_inv,
    NULL::numeric(14,2)              AS igst_inv,
    NULL::boolean                    AS is_interstate_inv
  FROM public.yarn_lot yl
  WHERE yl.total_amount IS NOT NULL AND yl.total_amount > 0
),
-- B) Bobbin purchases — vendor party lives on the bobbin master, not
--    the purchase row. No gst column → treated as 'without_gst'.
bobbin AS (
  SELECT
    'bobbin'::text                   AS source,
    bp.id                            AS source_id,
    bp.purchase_date                 AS bill_date,
    bp.invoice_no                    AS bill_no,
    b.supplier_party_id              AS party_id,
    COALESCE(bp.pieces_purchased, 0)::numeric(14,2) AS quantity,
    'pcs'::text                      AS qty_uom,
    0::numeric(6,2)                  AS gst_pct,
    bp.total_amount::numeric(14,2)   AS taxable,  -- without-GST: taxable == total
    bp.total_amount::numeric(14,2)   AS total,
    COALESCE(bp.amount_paid, 0)::numeric(14,2) AS amount_paid,
    'active'::text                   AS status,
    NULL::numeric(14,2)              AS cgst_inv,
    NULL::numeric(14,2)              AS sgst_inv,
    NULL::numeric(14,2)              AS igst_inv,
    NULL::boolean                    AS is_interstate_inv
  FROM public.bobbin_purchase bp
  LEFT JOIN public.bobbin b ON b.id = bp.bobbin_id
  WHERE bp.total_amount IS NOT NULL AND bp.total_amount > 0
),
-- C) Sizing jobs (charges from sizing vendor)
sizing AS (
  SELECT
    'sizing'::text                   AS source,
    sj.id                            AS source_id,
    COALESCE(sj.date_received, sj.date_sent) AS bill_date,
    sj.job_code                      AS bill_no,
    sj.party_id                      AS party_id,
    COALESCE(sj.yarn_sent_kg, 0)::numeric(14,2) AS quantity,
    'kg'::text                       AS qty_uom,
    COALESCE(sj.gst_pct, 0)::numeric(6,2) AS gst_pct,
    COALESCE(sj.charges_amount, 0)::numeric(14,2) AS taxable,
    COALESCE(sj.total_amount, 0)::numeric(14,2)  AS total,
    COALESCE(sj.amount_paid, 0)::numeric(14,2)   AS amount_paid,
    sj.status::text                  AS status,
    NULL::numeric(14,2)              AS cgst_inv,
    NULL::numeric(14,2)              AS sgst_inv,
    NULL::numeric(14,2)              AS igst_inv,
    NULL::boolean                    AS is_interstate_inv
  FROM public.sizing_job sj
  WHERE COALESCE(sj.total_amount, 0) > 0
    AND sj.status::text NOT IN ('draft', 'cancelled')
),
-- D) Fabric purchases (resale stock from outside)
fabric AS (
  SELECT
    'fabric'::text                   AS source,
    fp.id                            AS source_id,
    fp.received_date                 AS bill_date,
    fp.invoice_no                    AS bill_no,
    fp.supplier_party_id             AS party_id,
    fp.received_metres::numeric(14,2) AS quantity,
    'm'::text                        AS qty_uom,
    COALESCE(fp.gst_pct, 0)::numeric(6,2) AS gst_pct,
    ROUND(
      fp.total_amount / (1 + COALESCE(fp.gst_pct, 0) / 100.0), 2
    )::numeric(14,2)                 AS taxable,
    fp.total_amount::numeric(14,2)   AS total,
    COALESCE(fp.amount_paid, 0)::numeric(14,2) AS amount_paid,
    fp.status::text                  AS status,
    NULL::numeric(14,2)              AS cgst_inv,
    NULL::numeric(14,2)              AS sgst_inv,
    NULL::numeric(14,2)              AS igst_inv,
    NULL::boolean                    AS is_interstate_inv
  FROM public.fabric_purchase fp
  WHERE fp.total_amount IS NOT NULL AND fp.total_amount > 0
    AND fp.status::text NOT IN ('archived', 'inactive')
),
-- E) Outsource Weaving Bills (invoice doc_type='weaving_bill').
--    These already carry proper CGST/SGST/IGST split — pass them
--    through directly.
--    Note: jobwork_invoice rows are NOT included here — they are not
--    purchases (they relate to jobwork we perform for jobwork
--    parties, recorded on the invoice table for unified numbering).
weaving AS (
  SELECT
    'outsource_weaving'::text        AS source,
    inv.id                           AS source_id,
    inv.invoice_date                 AS bill_date,
    inv.invoice_no                   AS bill_no,
    inv.jobwork_party_id             AS party_id,
    COALESCE((
      SELECT SUM(il.quantity)
      FROM public.invoice_line il
      WHERE il.invoice_id = inv.id
    ), 0)::numeric(14,2)             AS quantity,
    'm'::text                        AS qty_uom,
    NULL::numeric(6,2)               AS gst_pct,   -- split lives on the row
    inv.taxable_value::numeric(14,2) AS taxable,
    inv.total::numeric(14,2)         AS total,
    COALESCE(inv.amount_paid, 0)::numeric(14,2) AS amount_paid,
    inv.status::text                 AS status,
    inv.cgst_amount::numeric(14,2)   AS cgst_inv,
    inv.sgst_amount::numeric(14,2)   AS sgst_inv,
    inv.igst_amount::numeric(14,2)   AS igst_inv,
    inv.is_interstate                AS is_interstate_inv
  FROM public.invoice inv
  WHERE inv.doc_type = 'weaving_bill'
    AND inv.status::text NOT IN ('draft', 'cancelled')
),
all_sources AS (
  SELECT * FROM yarn
  UNION ALL SELECT * FROM bobbin
  UNION ALL SELECT * FROM sizing
  UNION ALL SELECT * FROM fabric
  UNION ALL SELECT * FROM weaving
)
SELECT
  s.source,
  s.source_id,
  s.bill_date,
  s.bill_no,
  s.party_id,
  COALESCE(p.code, '')                       AS party_code,
  COALESCE(p.name, '—')                      AS party_name,
  p.gstin                                    AS party_gstin,
  p.state                                    AS party_state,
  s.quantity,
  s.qty_uom,
  COALESCE(s.gst_pct, 0)                     AS gst_pct,
  s.taxable,
  GREATEST(s.total - s.taxable, 0)::numeric(14,2) AS gst_amount,
  s.total,
  s.amount_paid,
  (s.total - s.amount_paid)::numeric(14,2)   AS balance,
  s.status,
  /* Interstate flag — for invoice-based rows we honour the stored flag;
     otherwise we compare supplier state to company state. */
  CASE
    WHEN s.is_interstate_inv IS NOT NULL THEN s.is_interstate_inv
    WHEN p.state IS NULL                  THEN false
    ELSE upper(p.state) <> c.state
  END                                        AS is_interstate,
  /* CGST/SGST/IGST split */
  CASE
    WHEN s.cgst_inv IS NOT NULL THEN s.cgst_inv
    WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN 0
    ELSE ROUND(GREATEST(s.total - s.taxable, 0) / 2.0, 2)
  END::numeric(14,2)                         AS cgst_amount,
  CASE
    WHEN s.sgst_inv IS NOT NULL THEN s.sgst_inv
    WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN 0
    ELSE ROUND(GREATEST(s.total - s.taxable, 0) / 2.0, 2)
  END::numeric(14,2)                         AS sgst_amount,
  CASE
    WHEN s.igst_inv IS NOT NULL THEN s.igst_inv
    WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN GREATEST(s.total - s.taxable, 0)
    ELSE 0
  END::numeric(14,2)                         AS igst_amount,
  /* with-GST / without-GST classification for the report filter */
  CASE
    WHEN COALESCE(s.gst_pct, 0) > 0
      OR s.cgst_inv IS NOT NULL
      OR s.sgst_inv IS NOT NULL
      OR s.igst_inv IS NOT NULL
      OR (s.total > s.taxable) THEN 'with_gst'
    ELSE 'without_gst'
  END                                        AS gst_flag
FROM all_sources s
CROSS JOIN company c
LEFT JOIN public.party p ON p.id = s.party_id
WHERE s.bill_date IS NOT NULL;

COMMENT ON VIEW public.v_purchase_register IS
  'Purchase Register mirror of v_sales_register. Unions yarn_lot / bobbin_purchase / sizing_job / fabric_purchase / invoice(weaving_bill,jobwork_invoice). CGST/SGST/IGST derived from gst_pct + supplier state vs company state (intrastate split 50/50, interstate becomes IGST). gst_flag = with_gst | without_gst for quick filtering.';

COMMIT;
