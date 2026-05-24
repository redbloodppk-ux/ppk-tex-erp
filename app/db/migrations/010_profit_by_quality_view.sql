-- ────────────────────────────────────────────────────────────────────────────
-- Migration 010 — Profit by Quality view (CORR-R5)
--
--   Pulls revenue (invoice_line) and cost (production_batch) side by side
--   per costing_master (= per quality).
--
--   Revenue   = sum of invoice_line.taxable_amount where invoice is a sale
--               (tax_invoice / general_sale) and not draft/cancelled.
--               Credit-notes that reference a costing_id are SUBTRACTED so
--               returns reduce the revenue.
--   Cost      = sum of production_batch.produced_m × actual_true_cost_per_m
--               (snapshotted at batch insert, so historical batches keep
--               their frozen cost).
--   Quantity  = invoice metres on the revenue side, produced metres on the
--               cost side. Shown side-by-side so you can spot mismatched
--               activity (e.g. invoiced 1000 m but only produced 600 m).
--
--   Margin   = revenue − cost (₹).
--   Margin % = margin ÷ revenue × 100 (NULL when revenue = 0).
--
--   The view exposes raw per-quality totals over ALL history; the report
--   page narrows by date range on its own.
--
-- Safe to re-run: DROP IF EXISTS + CREATE.
-- ────────────────────────────────────────────────────────────────────────────

DROP VIEW IF EXISTS v_quality_margin;
CREATE VIEW v_quality_margin AS
WITH revenue AS (
  SELECT
    il.costing_id,
    SUM(CASE
          WHEN inv.doc_type = 'credit_note' THEN -il.quantity
          ELSE il.quantity
        END)::numeric(14,2)              AS invoiced_m,
    SUM(CASE
          WHEN inv.doc_type = 'credit_note' THEN -il.taxable_amount
          ELSE il.taxable_amount
        END)::numeric(14,2)              AS total_revenue,
    MAX(inv.invoice_date)                AS last_invoice_date
  FROM invoice_line il
  JOIN invoice inv ON inv.id = il.invoice_id
  WHERE il.costing_id IS NOT NULL
    AND inv.status NOT IN ('draft', 'cancelled')
    AND inv.doc_type IN ('tax_invoice', 'general_sale', 'credit_note')
  GROUP BY il.costing_id
),
cost AS (
  SELECT
    pb.costing_id,
    SUM(pb.produced_m)::numeric(14,2)    AS produced_m,
    SUM(
      pb.produced_m * COALESCE(pb.actual_true_cost_per_m, 0)
    )::numeric(14,2)                     AS total_cost,
    MAX(pb.end_date)                     AS last_batch_date
  FROM production_batch pb
  WHERE pb.costing_id IS NOT NULL
    AND pb.produced_m > 0
  GROUP BY pb.costing_id
)
SELECT
  cm.id                                  AS costing_id,
  cm.quality_code,
  cm.quality_name,
  COALESCE(r.invoiced_m,    0)::numeric(14,2)  AS invoiced_m,
  COALESCE(r.total_revenue, 0)::numeric(14,2)  AS total_revenue,
  COALESCE(c.produced_m,    0)::numeric(14,2)  AS produced_m,
  COALESCE(c.total_cost,    0)::numeric(14,2)  AS total_cost,
  (COALESCE(r.total_revenue, 0) - COALESCE(c.total_cost, 0))::numeric(14,2) AS margin,
  CASE
    WHEN COALESCE(r.invoiced_m, 0) > 0
      THEN (COALESCE(r.total_revenue, 0) / r.invoiced_m)::numeric(10,4)
    ELSE NULL
  END                                    AS avg_sell_per_m,
  CASE
    WHEN COALESCE(c.produced_m, 0) > 0
      THEN (COALESCE(c.total_cost, 0) / c.produced_m)::numeric(10,4)
    ELSE NULL
  END                                    AS avg_cost_per_m,
  CASE
    WHEN COALESCE(r.total_revenue, 0) > 0
      THEN ((COALESCE(r.total_revenue, 0) - COALESCE(c.total_cost, 0))
             / r.total_revenue * 100)::numeric(7,2)
    ELSE NULL
  END                                    AS margin_pct,
  r.last_invoice_date,
  c.last_batch_date
FROM costing_master cm
LEFT JOIN revenue r ON r.costing_id = cm.id
LEFT JOIN cost    c ON c.costing_id = cm.id
WHERE COALESCE(r.invoiced_m, 0) <> 0
   OR COALESCE(c.produced_m, 0) > 0
ORDER BY (COALESCE(r.total_revenue, 0) - COALESCE(c.total_cost, 0)) DESC;

COMMENT ON VIEW v_quality_margin IS
  'CORR-R5: per-quality margin = revenue (invoice_line.taxable_amount, ex-GST) - cost (production_batch.produced_m × actual_true_cost_per_m). Uses snapshotted true cost so historical batches keep their frozen cost. Credit-notes subtract from revenue. Drafts and cancelled invoices are excluded.';

GRANT SELECT ON v_quality_margin TO authenticated;
