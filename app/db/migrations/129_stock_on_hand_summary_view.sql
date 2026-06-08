-- 129_stock_on_hand_summary_view.sql
--
-- v_stock_on_hand_summary — matrix view: 5 categories × 3 production
-- modes = 15 rows, one cell each. Drives the "Mode-wise stock summary"
-- panel on /app/reports/stock-on-hand.
--
-- Categories: warp_metre, weft_yarn, porvai_yarn, bobbin_metre, fabric
-- Modes:      in_house, jobwork, outsource
--
-- Source-of-truth for each cell:
--   warp_metre   in_house     → pavu (production_mode='in_house', status='in_stock')
--                jobwork      → jobwork_warp_beam JOIN jobwork_party.kind='jobwork'
--                outsource    → jobwork_warp_beam JOIN jobwork_party.kind='outsource'
--   weft_yarn    in_house     → yarn_lot (yarn_kind='yarn', delivery_destination='in_house', current_kg>0)
--                jobwork      → jobwork_weft_bag JOIN jobwork_party.kind='jobwork'
--                outsource    → jobwork_weft_bag JOIN jobwork_party.kind='outsource'
--   porvai_yarn  in_house     → yarn_lot (yarn_kind='porvai', delivery_destination='in_house', current_kg>0)
--                jobwork      → 0 (porvai-at-vendor not tracked separately yet)
--                outsource    → 0
--   bobbin_metre in_house     → bobbin (production_mode='inhouse' or null, status!='archived'), SUM(quantity*bobbin_metre)
--                jobwork      → bobbin (production_mode='jobwork')
--                outsource    → bobbin (production_mode='outsource')
--   fabric       in_house     → fabric_stock (source_type='inhouse', metres_available>0)
--                jobwork      → fabric_stock (source_type='jobwork',  metres_available>0)
--                outsource    → fabric_stock (source_type='outsourced', metres_available>0)
--                (= "fabric receipted but not yet invoiced" — the ledger view in
--                 fabric_stock.metres_available drains when sales reduce it.)
--
-- Re-runnable: DROP + CREATE.

BEGIN;

DROP VIEW IF EXISTS public.v_stock_on_hand_summary CASCADE;

CREATE VIEW public.v_stock_on_hand_summary
WITH (security_invoker=on) AS
-- ── WARP METRE ─────────────────────────────────────────────────────
SELECT 'warp_metre'::text  AS category, 'in_house'::text  AS mode, 'm'::text AS unit,
       COALESCE(SUM(meters), 0)::numeric(14,2)            AS qty
  FROM public.pavu
 WHERE production_mode = 'in_house' AND status = 'in_stock'
UNION ALL
SELECT 'warp_metre', 'jobwork', 'm',
       COALESCE(SUM(jwb.total_metres), 0)::numeric(14,2)
  FROM public.jobwork_warp_beam jwb
  JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
 WHERE jp.kind = 'jobwork' AND jwb.total_metres > 0
UNION ALL
SELECT 'warp_metre', 'outsource', 'm',
       COALESCE(SUM(jwb.total_metres), 0)::numeric(14,2)
  FROM public.jobwork_warp_beam jwb
  JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
 WHERE jp.kind = 'outsource' AND jwb.total_metres > 0

-- ── WEFT YARN ──────────────────────────────────────────────────────
UNION ALL
SELECT 'weft_yarn', 'in_house', 'kg',
       COALESCE(SUM(current_kg), 0)::numeric(14,2)
  FROM public.yarn_lot
 WHERE delivery_destination = 'in_house'
   AND COALESCE(yarn_kind, 'yarn') = 'yarn'
   AND current_kg > 0
UNION ALL
SELECT 'weft_yarn', 'jobwork', 'kg',
       COALESCE(SUM(jwb.total_kg), 0)::numeric(14,2)
  FROM public.jobwork_weft_bag jwb
  JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
 WHERE jp.kind = 'jobwork' AND jwb.total_kg > 0
UNION ALL
SELECT 'weft_yarn', 'outsource', 'kg',
       COALESCE(SUM(jwb.total_kg), 0)::numeric(14,2)
  FROM public.jobwork_weft_bag jwb
  JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
 WHERE jp.kind = 'outsource' AND jwb.total_kg > 0

-- ── PORVAI YARN ────────────────────────────────────────────────────
UNION ALL
SELECT 'porvai_yarn', 'in_house', 'kg',
       COALESCE(SUM(current_kg), 0)::numeric(14,2)
  FROM public.yarn_lot
 WHERE delivery_destination = 'in_house'
   AND yarn_kind = 'porvai'
   AND current_kg > 0
UNION ALL
SELECT 'porvai_yarn', 'jobwork',   'kg', 0::numeric(14,2)
UNION ALL
SELECT 'porvai_yarn', 'outsource', 'kg', 0::numeric(14,2)

-- ── BOBBIN METRE ───────────────────────────────────────────────────
UNION ALL
SELECT 'bobbin_metre', 'in_house', 'm',
       COALESCE(SUM(quantity * bobbin_metre), 0)::numeric(14,2)
  FROM public.bobbin
 WHERE COALESCE(production_mode, 'inhouse') = 'inhouse'
   AND quantity > 0
   AND COALESCE(status, 'active') <> 'archived'
UNION ALL
SELECT 'bobbin_metre', 'jobwork', 'm',
       COALESCE(SUM(quantity * bobbin_metre), 0)::numeric(14,2)
  FROM public.bobbin
 WHERE production_mode = 'jobwork'
   AND quantity > 0
   AND COALESCE(status, 'active') <> 'archived'
UNION ALL
SELECT 'bobbin_metre', 'outsource', 'm',
       COALESCE(SUM(quantity * bobbin_metre), 0)::numeric(14,2)
  FROM public.bobbin
 WHERE production_mode = 'outsource'
   AND quantity > 0
   AND COALESCE(status, 'active') <> 'archived'

-- ── FABRIC (received but not invoiced) ────────────────────────────
UNION ALL
SELECT 'fabric', 'in_house', 'm',
       COALESCE(SUM(metres_available), 0)::numeric(14,2)
  FROM public.fabric_stock
 WHERE source_type = 'inhouse' AND metres_available > 0
UNION ALL
SELECT 'fabric', 'jobwork', 'm',
       COALESCE(SUM(metres_available), 0)::numeric(14,2)
  FROM public.fabric_stock
 WHERE source_type = 'jobwork' AND metres_available > 0
UNION ALL
SELECT 'fabric', 'outsource', 'm',
       COALESCE(SUM(metres_available), 0)::numeric(14,2)
  FROM public.fabric_stock
 WHERE source_type = 'outsourced' AND metres_available > 0;

COMMENT ON VIEW public.v_stock_on_hand_summary IS
  'Stock-on-hand summary matrix: one row per (category × mode). 5 categories (warp_metre, weft_yarn, porvai_yarn, bobbin_metre, fabric) × 3 modes (in_house, jobwork, outsource). Fabric quantities are "received but not yet invoiced" because fabric_stock.metres_available drains on sale.';

COMMIT;
