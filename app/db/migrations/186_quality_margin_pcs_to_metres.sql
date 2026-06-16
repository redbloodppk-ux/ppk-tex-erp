-- 186_quality_margin_pcs_to_metres.sql
--
-- Bug in v_quality_margin: when a towel quality is billed in pieces
-- (invoice_line.uom = 'pcs'), the report was treating quantity as
-- metres directly. Result: invoiced_m and avg_sell_per_m were both
-- off by the towel-length factor — e.g. for COST-0002 (towel_length
-- 1.7 m), the displayed Sell ₹/m was 70%-larger than reality because
-- 1 piece was being counted as 1 metre.
--
-- Fix: derive a per-line metres factor:
--   factor =
--     CASE
--       WHEN il.uom = 'pcs'
--        AND cm.fabric_type = 'towel'
--        AND (cm.calc_snapshot->>'towelLength')::numeric > 0
--       THEN (cm.calc_snapshot->>'towelLength')::numeric
--       ELSE 1
--     END
--   true_metres = il.quantity * factor
--
-- Cost side already uses true_cost_per_m × invoiced_m, so converting
-- invoiced_m to true metres fixes BOTH sides at once — total_cost
-- moves up to match the metres × Rs/m formula correctly. Revenue is
-- already in absolute rupees (no factor), so it stays unchanged.
--
-- For non-towel qualities or lines billed in 'mtr', factor = 1 and the
-- formula degenerates to the previous behaviour.

BEGIN;

DROP VIEW IF EXISTS v_quality_margin CASCADE;

CREATE VIEW v_quality_margin AS
WITH lines AS (
  /* Per-line resolved metres for towel-pcs invoices. */
  SELECT
    il.costing_id,
    inv.doc_type,
    inv.invoice_date,
    il.taxable_amount,
    il.quantity * CASE
      WHEN il.uom = 'pcs'
        AND cm.fabric_type = 'towel'
        AND (cm.calc_snapshot->>'towelLength') IS NOT NULL
        AND (cm.calc_snapshot->>'towelLength')::numeric > 0
      THEN (cm.calc_snapshot->>'towelLength')::numeric
      ELSE 1
    END AS true_metres
  FROM invoice_line il
  JOIN invoice inv      ON inv.id = il.invoice_id
  JOIN costing_master cm ON cm.id = il.costing_id
  WHERE il.costing_id IS NOT NULL
    AND inv.status NOT IN ('draft', 'cancelled')
    AND inv.doc_type IN ('tax_invoice', 'general_sale', 'credit_note')
),
revenue AS (
  SELECT
    l.costing_id,
    SUM(CASE
          WHEN l.doc_type = 'credit_note' THEN -l.true_metres
          ELSE l.true_metres
        END)::numeric(14,2)              AS invoiced_m,
    SUM(CASE
          WHEN l.doc_type = 'credit_note' THEN -l.taxable_amount
          ELSE l.taxable_amount
        END)::numeric(14,2)              AS total_revenue,
    MAX(l.invoice_date)                  AS last_invoice_date
  FROM lines l
  GROUP BY l.costing_id
),
cost AS (
  /* Live cost per quality = TRUE invoiced metres × true_cost_per_m. */
  SELECT
    r.costing_id,
    r.invoiced_m                                              AS produced_m,
    (r.invoiced_m * COALESCE(tc.true_cost_per_m, 0))::numeric(14,2) AS total_cost,
    NULL::date                                                AS last_batch_date
  FROM revenue r
  LEFT JOIN public.v_costing_two_cost tc ON tc.id = r.costing_id
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
  'Per-quality margin. invoiced_m converts towel-pcs lines to true metres via calc_snapshot.towelLength (migration 186). Cost = invoiced_m × live true_cost_per_m. Credit-notes subtract from both metres and revenue. Drafts and cancelled invoices excluded.';

GRANT SELECT ON v_quality_margin TO authenticated;

COMMIT;
