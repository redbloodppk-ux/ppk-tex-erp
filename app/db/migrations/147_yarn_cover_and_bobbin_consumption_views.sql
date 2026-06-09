-- 147_yarn_cover_and_bobbin_consumption_views.sql
--
-- Two report-source views that the original migrations (017 + 018)
-- never produced cleanly against the current DB:
--
--   v_yarn_cover_dashboard
--     Days-of-Cover report. Migration 017 joined v_yarn_days_of_cover
--     by yarn_count_id with column 'available_kg', but the deployed
--     v_yarn_days_of_cover uses yarn_count_code + on_hand_kg. Adapted
--     to the actual columns. kg_30d is exposed as NULL until the
--     30-day-consumption rollup exists.
--
--   v_bobbin_consumption
--     Bobbin Consumption report. Migration 018 joined a 'mill' table
--     which was dropped by migration 098 in favour of 'party'. Adapted
--     to resolve vendor_name via bobbin.supplier_party_id -> party.

DROP VIEW IF EXISTS public.v_yarn_cover_dashboard CASCADE;
CREATE VIEW public.v_yarn_cover_dashboard
WITH (security_invoker = on) AS
SELECT
  yc.id                                                    AS yarn_count_id,
  yc.code,
  yc.display_name,
  yc.yarn_type,
  yc.reorder_kg,
  yc.status,
  COALESCE(doc.on_hand_kg, 0)::numeric(14,2)               AS available_kg,
  NULL::numeric(14,2)                                      AS kg_30d,
  doc.days_of_cover,
  CASE
    WHEN yc.reorder_kg IS NOT NULL
     AND yc.reorder_kg > 0
     AND COALESCE(doc.on_hand_kg, 0) < yc.reorder_kg
    THEN true ELSE false
  END                                                      AS below_reorder,
  CASE
    WHEN COALESCE(doc.on_hand_kg, 0) = 0          THEN 'out'
    WHEN doc.days_of_cover IS NULL                THEN 'idle'
    WHEN doc.days_of_cover < 7                    THEN 'critical'
    WHEN doc.days_of_cover < 21                   THEN 'low'
    ELSE 'ok'
  END                                                      AS cover_status
FROM public.yarn_count yc
LEFT JOIN public.v_yarn_days_of_cover doc ON doc.yarn_count_code = yc.code;

COMMENT ON VIEW public.v_yarn_cover_dashboard IS
  'Yarn days-of-cover dashboard. Joins yarn_count to v_yarn_days_of_cover via the code.';

DROP VIEW IF EXISTS public.v_bobbin_consumption CASCADE;
CREATE VIEW public.v_bobbin_consumption
WITH (security_invoker = on) AS
WITH batch_bobbin AS (
  SELECT bobbin_1_id AS bobbin_id, COALESCE(produced_m, 0) AS produced_m
    FROM public.production_batch
   WHERE bobbin_1_id IS NOT NULL
  UNION ALL
  SELECT bobbin_2_id AS bobbin_id, COALESCE(produced_m, 0) AS produced_m
    FROM public.production_batch
   WHERE bobbin_2_id IS NOT NULL
),
usage AS (
  SELECT bobbin_id, COUNT(*) AS batches_used, COALESCE(SUM(produced_m), 0) AS produced_m_total
  FROM batch_bobbin
  GROUP BY bobbin_id
),
stock AS (
  SELECT bobbin_id, COALESCE(SUM(quantity_pcs), 0) AS stock_pcs
  FROM public.bobbin_stock
  GROUP BY bobbin_id
)
SELECT
  b.id                                                     AS bobbin_id,
  b.code,
  b.description,
  b.is_lurex,
  b.supplier_party_id                                      AS vendor_id,
  p.name                                                   AS vendor_name,
  b.bobbin_metre,
  b.bobbin_price,
  b.ends_per_bobbin,
  b.loading_per_metre,
  b.reorder_pieces,
  CASE WHEN b.bobbin_metre > 0
       THEN (b.bobbin_price / b.bobbin_metre)::numeric(12,4)
       ELSE NULL END                                       AS rupee_per_m,
  COALESCE(s.stock_pcs, 0)::numeric(14,2)                  AS stock_pcs,
  CASE WHEN b.reorder_pieces IS NOT NULL
        AND b.reorder_pieces > 0
        AND COALESCE(s.stock_pcs, 0) < b.reorder_pieces
       THEN true ELSE false END                            AS below_reorder,
  COALESCE(u.batches_used, 0)::integer                     AS batches_used,
  COALESCE(u.produced_m_total, 0)::numeric(14,2)           AS produced_m_total,
  CASE WHEN b.bobbin_metre > 0
       THEN (COALESCE(u.produced_m_total, 0) / b.bobbin_metre)::numeric(14,4)
       ELSE NULL END                                       AS pieces_consumed_equiv,
  CASE WHEN b.bobbin_metre > 0
       THEN floor(COALESCE(u.produced_m_total, 0) / b.bobbin_metre)::integer
       ELSE NULL END                                       AS whole_pieces_consumed,
  CASE WHEN b.bobbin_metre > 0
       THEN ((COALESCE(u.produced_m_total, 0) / b.bobbin_metre)
             - floor(COALESCE(u.produced_m_total, 0) / b.bobbin_metre))::numeric(6,4)
       ELSE NULL END                                       AS partial_piece_fraction,
  CASE WHEN b.bobbin_metre > 0 AND COALESCE(u.produced_m_total, 0) > 0
       THEN ((COALESCE(u.produced_m_total, 0) / b.bobbin_metre)
             * b.bobbin_price)::numeric(14,2)
       ELSE 0::numeric(14,2) END                           AS bobbin_spend
FROM public.bobbin b
LEFT JOIN public.party p ON p.id = b.supplier_party_id
LEFT JOIN usage u ON u.bobbin_id = b.id
LEFT JOIN stock s ON s.bobbin_id = b.id;

COMMENT ON VIEW public.v_bobbin_consumption IS
  'Per-bobbin cost / stock / batch-usage / split-piece consumption. Vendor name resolved via supplier_party_id -> party (mill table dropped by migration 098).';
