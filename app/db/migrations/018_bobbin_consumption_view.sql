-- ─────────────────────────────────────────────────────────────────────────
-- 018_bobbin_consumption_view.sql      (CORR-R10)
--
-- v_bobbin_consumption
--   One row per bobbin (warp beam). Two halves to the report:
--
--   1. Cost — rupee_per_m = bobbin_price / bobbin_metre. This is how much
--      one bobbin contributes to the cost of every metre of fabric it
--      weaves. Computable from the bobbin master alone.
--
--   2. Split-piece reconciliation — bobbins are bought as whole pieces but
--      consumed continuously in metres. A bobbin yields bobbin_metre metres
--      of fabric. So the pieces a bobbin has actually used up is:
--          pieces_consumed_equiv = produced_m_total / bobbin_metre
--      which is normally fractional. We split that into:
--          whole_pieces_consumed   - fully used-up bobbins (floor)
--          partial_piece_fraction  - how much of the current bobbin is gone
--      Production metres come from production_batch, where a batch can name
--      up to two bobbins (bobbin_1_id, bobbin_2_id); both are unnested so a
--      batch that runs two beams counts metres against each.
--
--   stock_pcs / below_reorder come from bobbin_stock vs reorder_pieces.
--
--   NOTE: when there are no production batches yet, the usage half is all
--   zero — the cost and stock halves still work. There is no separate
--   bobbin-issue log in the schema, so reconciliation is derived from
--   produced metres rather than from physical issue slips.
--
-- Idempotent: DROP + CREATE inside a single transaction.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

DROP VIEW IF EXISTS public.v_bobbin_consumption CASCADE;

CREATE VIEW public.v_bobbin_consumption
WITH (security_invoker = on) AS
WITH batch_bobbin AS (
  SELECT bobbin_1_id AS bobbin_id, COALESCE(produced_m, 0) AS produced_m
    FROM production_batch
   WHERE bobbin_1_id IS NOT NULL
  UNION ALL
  SELECT bobbin_2_id AS bobbin_id, COALESCE(produced_m, 0) AS produced_m
    FROM production_batch
   WHERE bobbin_2_id IS NOT NULL
),
usage AS (
  SELECT
    bobbin_id,
    COUNT(*)                       AS batches_used,
    COALESCE(SUM(produced_m), 0)   AS produced_m_total
  FROM batch_bobbin
  GROUP BY bobbin_id
),
stock AS (
  SELECT bobbin_id, COALESCE(SUM(quantity_pcs), 0) AS stock_pcs
  FROM bobbin_stock
  GROUP BY bobbin_id
)
SELECT
  b.id                                                    AS bobbin_id,
  b.code,
  b.description,
  b.is_lurex,
  b.vendor_id,
  m.name                                                  AS vendor_name,

  b.bobbin_metre,
  b.bobbin_price,
  b.ends_per_bobbin,
  b.loading_per_metre,
  b.reorder_pieces,

  CASE
    WHEN b.bobbin_metre > 0
      THEN (b.bobbin_price / b.bobbin_metre)::numeric(12,4)
    ELSE NULL
  END                                                     AS rupee_per_m,

  COALESCE(s.stock_pcs, 0)::numeric(14,2)                 AS stock_pcs,
  CASE
    WHEN b.reorder_pieces IS NOT NULL
     AND b.reorder_pieces > 0
     AND COALESCE(s.stock_pcs, 0) < b.reorder_pieces
    THEN true ELSE false
  END                                                     AS below_reorder,

  COALESCE(u.batches_used, 0)::integer                    AS batches_used,
  COALESCE(u.produced_m_total, 0)::numeric(14,2)          AS produced_m_total,

  CASE
    WHEN b.bobbin_metre > 0
      THEN (COALESCE(u.produced_m_total, 0) / b.bobbin_metre)::numeric(14,4)
    ELSE NULL
  END                                                     AS pieces_consumed_equiv,
  CASE
    WHEN b.bobbin_metre > 0
      THEN floor(COALESCE(u.produced_m_total, 0) / b.bobbin_metre)::integer
    ELSE NULL
  END                                                     AS whole_pieces_consumed,
  CASE
    WHEN b.bobbin_metre > 0
      THEN ((COALESCE(u.produced_m_total, 0) / b.bobbin_metre)
            - floor(COALESCE(u.produced_m_total, 0) / b.bobbin_metre))::numeric(6,4)
    ELSE NULL
  END                                                     AS partial_piece_fraction,

  CASE
    WHEN b.bobbin_metre > 0 AND COALESCE(u.produced_m_total, 0) > 0
      THEN ((COALESCE(u.produced_m_total, 0) / b.bobbin_metre)
            * b.bobbin_price)::numeric(14,2)
    ELSE 0::numeric(14,2)
  END                                                     AS bobbin_spend

FROM bobbin b
LEFT JOIN mill  m ON m.id = b.vendor_id
LEFT JOIN usage u ON u.bobbin_id = b.id
LEFT JOIN stock s ON s.bobbin_id = b.id;

COMMENT ON VIEW public.v_bobbin_consumption IS
  'CORR-R10 Bobbin consumption. One row per bobbin: rupee/m cost, stock pcs, reorder flag, batch usage and split-piece reconciliation (whole + partial pieces consumed).';

COMMIT;
