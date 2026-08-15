-- ─────────────────────────────────────────────────────────────────────────
-- 251_sales_register_hsn.sql
--
-- Add an HSN column to v_sales_register so the Sales Register Excel export
-- can show it. HSN/SAC codes live per-line on invoice_line.hsn_sac, but this
-- view is per-invoice, so a single invoice can carry more than one HSN code
-- (e.g. a mixed towel + fabric bill). We aggregate the distinct codes on the
-- invoice into one comma-separated string, the same scalar-subquery shape
-- already used for total_quantity (migration 011).
--
-- Idempotent: DROP + CREATE inside a single transaction, same pattern as
-- migrations 011 and 250.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DROP VIEW IF EXISTS public.v_sales_register CASCADE;

CREATE VIEW public.v_sales_register
WITH (security_invoker=on) AS
SELECT
  inv.id                                              AS invoice_id,
  inv.invoice_no,
  inv.invoice_date,
  inv.doc_type,
  inv.status,
  inv.is_interstate,
  inv.customer_id,
  COALESCE(c.code, '')                                AS customer_code,
  COALESCE(c.name, inv.party_name, '—')              AS customer_name,
  COALESCE(c.gstin, inv.party_gstin)                  AS party_gstin,
  COALESCE(c.state, inv.party_state)                  AS party_state,
  inv.taxable_value,
  inv.cgst_amount,
  inv.sgst_amount,
  inv.igst_amount,
  inv.gst_amount,
  inv.total,
  inv.balance,
  inv.amount_paid,

  /* Sign factor: credit notes reduce sales, everything else adds. */
  CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END                             AS sign,

  /* Pre-signed totals so the UI can just SUM() without per-row branching. */
  (CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END * inv.taxable_value)::numeric(14,2)  AS signed_taxable,
  (CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END * inv.cgst_amount)::numeric(14,2)    AS signed_cgst,
  (CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END * inv.sgst_amount)::numeric(14,2)    AS signed_sgst,
  (CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END * inv.igst_amount)::numeric(14,2)    AS signed_igst,
  (CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END * inv.gst_amount)::numeric(14,2)     AS signed_gst,
  (CASE WHEN inv.doc_type = 'credit_note' THEN -1 ELSE 1 END * inv.total)::numeric(14,2)          AS signed_total,

  /* Aggregate quantity (metres / kg / pcs) across the invoice's lines so
     the register can show a "Qty" column without a second query. We sum
     line.quantity raw — UOM is mixed across line types so this is a
     scalar that the UI labels generically as "Qty". */
  COALESCE((
    SELECT SUM(il.quantity)
    FROM invoice_line il
    WHERE il.invoice_id = inv.id
  ), 0)::numeric(14,2)                                AS total_quantity,

  /* Distinct HSN/SAC codes billed on this invoice, comma-separated. Most
     invoices carry a single code; mixed bills (e.g. towel + fabric lines
     on one invoice) show all of them. */
  COALESCE((
    SELECT string_agg(DISTINCT il.hsn_sac, ', ' ORDER BY il.hsn_sac)
    FROM invoice_line il
    WHERE il.invoice_id = inv.id
      AND il.hsn_sac IS NOT NULL
      AND il.hsn_sac <> ''
  ), '')                                               AS hsn_codes
FROM invoice inv
LEFT JOIN customer c ON c.id = inv.customer_id
WHERE inv.status NOT IN ('draft', 'cancelled')
  AND inv.doc_type IN (
    'tax_invoice', 'yarn_sale', 'general_sale', 'jobwork_invoice', 'credit_note', 'debit_note'
  );

COMMENT ON VIEW public.v_sales_register IS
  'CORR-R1 Sales Register. One row per billed invoice (incl. jobwork invoices). Credit notes carry negative signed_* columns; SUM(signed_total) = net sales for the period. hsn_codes = comma-separated distinct HSN/SAC codes billed on the invoice.';

COMMIT;
