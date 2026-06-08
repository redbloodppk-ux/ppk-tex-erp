-- 130_stock_on_hand_summary_fn.sql
--
-- Adds an optional fabric-quality filter to the mode-wise stock-on-hand
-- summary. The earlier v_stock_on_hand_summary view (migration 129)
-- couldn't accept parameters, so we replace it with a SQL function and
-- recreate the view as a no-arg wrapper for back-compat.
--
-- API:
--   fn_stock_on_hand_summary(p_quality_id bigint DEFAULT NULL)
--     RETURNS (category text, mode text, unit text, qty numeric)
--
--   p_quality_id = NULL  → global matrix (every category counted).
--   p_quality_id = <id>  → only rows that carry a fabric_quality_id
--                          link are filtered:
--                            • warp_metre jobwork   (jobwork_warp_beam.fabric_quality_id)
--                            • warp_metre outsource (jobwork_warp_beam.fabric_quality_id)
--                            • fabric (all 3 modes via fabric_stock.costing_id)
--                          Categories with no natural quality link
--                          (warp in-house, weft, porvai, bobbin)
--                          return 0 so the matrix paints a full grid;
--                          the report page renders those cells as "N/A".
--
-- The view v_stock_on_hand_summary is recreated as
--   SELECT * FROM fn_stock_on_hand_summary(NULL)
-- so any consumer that hard-codes the view name keeps working.

BEGIN;

-- DROP VIEW first — CREATE OR REPLACE VIEW can't change column types.
DROP VIEW IF EXISTS public.v_stock_on_hand_summary CASCADE;

CREATE OR REPLACE FUNCTION public.fn_stock_on_hand_summary(p_quality_id bigint DEFAULT NULL)
RETURNS TABLE (category text, mode text, unit text, qty numeric)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  -- WARP METRE
  SELECT 'warp_metre'::text AS category, 'in_house'::text AS mode, 'm'::text AS unit,
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((SELECT SUM(meters) FROM public.pavu
                              WHERE production_mode = 'in_house' AND status = 'in_stock'), 0)
              ELSE 0
         END::numeric(14,2) AS qty
  UNION ALL
  SELECT 'warp_metre', 'jobwork', 'm',
         COALESCE((
           SELECT SUM(jwb.total_metres)
           FROM public.jobwork_warp_beam jwb
           JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
           WHERE jp.kind = 'jobwork' AND jwb.total_metres > 0
             AND (p_quality_id IS NULL OR jwb.fabric_quality_id = p_quality_id)
         ), 0)::numeric(14,2)
  UNION ALL
  SELECT 'warp_metre', 'outsource', 'm',
         COALESCE((
           SELECT SUM(jwb.total_metres)
           FROM public.jobwork_warp_beam jwb
           JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
           WHERE jp.kind = 'outsource' AND jwb.total_metres > 0
             AND (p_quality_id IS NULL OR jwb.fabric_quality_id = p_quality_id)
         ), 0)::numeric(14,2)
  -- WEFT YARN
  UNION ALL
  SELECT 'weft_yarn', 'in_house', 'kg',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((SELECT SUM(current_kg) FROM public.yarn_lot
                              WHERE delivery_destination = 'in_house'
                                AND COALESCE(yarn_kind, 'yarn') = 'yarn'
                                AND current_kg > 0), 0)
              ELSE 0
         END::numeric(14,2)
  UNION ALL
  SELECT 'weft_yarn', 'jobwork', 'kg',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((
                SELECT SUM(jwb.total_kg)
                FROM public.jobwork_weft_bag jwb
                JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
                WHERE jp.kind = 'jobwork' AND jwb.total_kg > 0
              ), 0)
              ELSE 0
         END::numeric(14,2)
  UNION ALL
  SELECT 'weft_yarn', 'outsource', 'kg',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((
                SELECT SUM(jwb.total_kg)
                FROM public.jobwork_weft_bag jwb
                JOIN public.jobwork_party jp ON jp.id = jwb.jobwork_party_id
                WHERE jp.kind = 'outsource' AND jwb.total_kg > 0
              ), 0)
              ELSE 0
         END::numeric(14,2)
  -- PORVAI YARN
  UNION ALL
  SELECT 'porvai_yarn', 'in_house', 'kg',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((SELECT SUM(current_kg) FROM public.yarn_lot
                              WHERE delivery_destination = 'in_house'
                                AND yarn_kind = 'porvai'
                                AND current_kg > 0), 0)
              ELSE 0
         END::numeric(14,2)
  UNION ALL
  SELECT 'porvai_yarn', 'jobwork',   'kg', 0::numeric(14,2)
  UNION ALL
  SELECT 'porvai_yarn', 'outsource', 'kg', 0::numeric(14,2)
  -- BOBBIN METRE
  UNION ALL
  SELECT 'bobbin_metre', 'in_house', 'm',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((SELECT SUM(quantity * bobbin_metre) FROM public.bobbin
                              WHERE COALESCE(production_mode, 'inhouse') = 'inhouse'
                                AND quantity > 0
                                AND COALESCE(status, 'active') <> 'archived'), 0)
              ELSE 0
         END::numeric(14,2)
  UNION ALL
  SELECT 'bobbin_metre', 'jobwork', 'm',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((SELECT SUM(quantity * bobbin_metre) FROM public.bobbin
                              WHERE production_mode = 'jobwork'
                                AND quantity > 0
                                AND COALESCE(status, 'active') <> 'archived'), 0)
              ELSE 0
         END::numeric(14,2)
  UNION ALL
  SELECT 'bobbin_metre', 'outsource', 'm',
         CASE WHEN p_quality_id IS NULL
              THEN COALESCE((SELECT SUM(quantity * bobbin_metre) FROM public.bobbin
                              WHERE production_mode = 'outsource'
                                AND quantity > 0
                                AND COALESCE(status, 'active') <> 'archived'), 0)
              ELSE 0
         END::numeric(14,2)
  -- FABRIC (received but not invoiced)
  UNION ALL
  SELECT 'fabric', 'in_house', 'm',
         COALESCE((SELECT SUM(metres_available) FROM public.fabric_stock
                    WHERE source_type = 'inhouse' AND metres_available > 0
                      AND (p_quality_id IS NULL OR costing_id = p_quality_id)), 0)::numeric(14,2)
  UNION ALL
  SELECT 'fabric', 'jobwork', 'm',
         COALESCE((SELECT SUM(metres_available) FROM public.fabric_stock
                    WHERE source_type = 'jobwork' AND metres_available > 0
                      AND (p_quality_id IS NULL OR costing_id = p_quality_id)), 0)::numeric(14,2)
  UNION ALL
  SELECT 'fabric', 'outsource', 'm',
         COALESCE((SELECT SUM(metres_available) FROM public.fabric_stock
                    WHERE source_type = 'outsourced' AND metres_available > 0
                      AND (p_quality_id IS NULL OR costing_id = p_quality_id)), 0)::numeric(14,2);
$$;

COMMENT ON FUNCTION public.fn_stock_on_hand_summary(bigint) IS
  'Mode-wise stock-on-hand matrix with optional fabric-quality filter. NULL = global; <id> = filter rows that carry a fabric_quality link (warp jobwork/outsource + all fabric rows). Categories with no link return 0 when filter is active so the page can render N/A.';

CREATE VIEW public.v_stock_on_hand_summary
WITH (security_invoker=on) AS
SELECT category, mode, unit, qty
  FROM public.fn_stock_on_hand_summary(NULL);

COMMENT ON VIEW public.v_stock_on_hand_summary IS
  'Wrapper for fn_stock_on_hand_summary(NULL). Kept for back-compat with any consumer that queries the view directly.';

COMMIT;
