-- 182_quality_margin_use_live_true_cost.sql
--
-- Profit by Quality used to compute cost as
--   SUM(production_batch.produced_m × actual_true_cost_per_m)
-- which only works if the operator records production batches with a
-- frozen true-cost snapshot. PPK TEX never adopted batch tracking, so
-- the report has been showing cost=0 (margin=100%) for every quality.
--
-- The right cost-side number for a simple weaving P&L is:
--   SUM(invoice_line.quantity × costing_master.true_cost_per_m)
-- — i.e. metres sold × current true cost. true_cost_per_m is already
-- live via v_costing_two_cost (migration 181, recomputed from latest
-- yarn purchase prices), so this formula automatically picks up rate
-- moves without any extra plumbing.
--
-- Tradeoff vs the old design:
--   + Works WITHOUT production batches. Owner sees real margin today.
--   + Cost moves with yarn prices automatically.
--   - Lost the snapshot-at-batch property — historical bills get
--     re-margined whenever yarn prices change. Acceptable for now
--     because no other place reads the snapshot anyway.
--
-- Idempotent: DROP + CREATE.

BEGIN;

DROP VIEW IF EXISTS v_quality_margin CASCADE;

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
  /* Live cost per quality = invoiced metres × true_cost_per_m from
     v_costing_two_cost. true_cost is itself live off yarn prices. */
  SELECT
    r.costing_id,
    r.invoiced_m                              AS produced_m,
    (r.invoiced_m * COALESCE(tc.true_cost_per_m, 0))::numeric(14,2) AS total_cost,
    NULL::date                                AS last_batch_date
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
  'Per-quality margin = invoiced revenue - (invoiced metres × live true_cost_per_m from v_costing_two_cost). Updated by migration 182 to NOT require production_batch snapshots. Credit-notes subtract from both metres and revenue. Drafts and cancelled invoices excluded.';

GRANT SELECT ON v_quality_margin TO authenticated;

COMMIT;
