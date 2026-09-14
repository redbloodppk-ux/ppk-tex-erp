-- ============================================================================
-- 300: Stock on Hand, count by count, for jobwork and outsource too.
--
-- PPK, 2026-09-14: "we need filter for inhouse, jobwork and outsource based".
--
-- The mode-wise matrix at the top of Stock on Hand has had those three
-- columns since migration 129, but the table underneath - the one with the
-- per-count detail, cost and reorder flags - only ever showed PPK's own
-- yarn. Asking "how much 40s is sitting with my jobwork parties" had no
-- answer on the page.
--
-- WHERE EACH MODE'S YARN LIVES
--   in-house            yarn_lot, delivery_destination = 'in_house'
--   jobwork/outsource   jobwork_weft_bag, via jobwork_party.kind
-- Two different tables, so one view cannot serve both. fn_stock_by_mode
-- returns the vendor side in the same column shape v_stock_on_hand uses,
-- so the screen renders either through one set of components.
--
-- WHAT IS HONESTLY MISSING FOR VENDOR STOCK
-- jobwork_weft_bag records kg and bag count, not a rate. So cost per kg and
-- stock value come back NULL rather than zero - a zero would read as "this
-- yarn is worth nothing", which is a different claim from "we never
-- recorded what it cost". Days of cover is NULL for the same reason: the
-- cover view measures the mill's own consumption, and yarn sitting at a
-- jobwork party is not being drawn from the mill's shelf.
--
-- ALSO FIXED HERE: v_stock_on_hand counted every yarn_lot regardless of
-- destination, while v_yarn_days_of_cover (migration 299) now counts
-- in-house only. Left alone, the same screen would show available_kg
-- including sizing yarn next to a cover figure that excluded it. Both now
-- mean the same thing. No figure moves today - every sizing lot is already
-- at zero - but the next one bought would have split them.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_stock_on_hand AS
WITH lot_agg AS (
  SELECT yl.yarn_count_id,
         sum(yl.current_kg) AS available_kg,
         sum(yl.current_kg * yl.cost_per_kg) AS stock_value_raw,
         count(*) AS lots_count,
         min(yl.received_date) AS oldest_lot_date,
         max(yl.received_date) AS newest_lot_date
    FROM public.yarn_lot yl
   WHERE yl.current_kg > 0::numeric
     -- In-house only, to match v_yarn_days_of_cover. Yarn delivered
     -- straight to the sizing mill never reaches the shelf.
     AND COALESCE(yl.delivery_destination, 'in_house') = 'in_house'
   GROUP BY yl.yarn_count_id
)
SELECT yc.id AS yarn_count_id,
       yc.code,
       yc.display_name,
       yc.yarn_type,
       yc.ne,
       yc.denier,
       yc.is_doubled,
       yc.is_slub,
       yc.reorder_kg,
       yc.status,
       COALESCE(la.available_kg, 0::numeric)::numeric(14,2) AS available_kg,
       CASE WHEN COALESCE(la.available_kg, 0::numeric) > 0::numeric
            THEN (la.stock_value_raw / la.available_kg)::numeric(14,4)
            ELSE NULL::numeric END AS weighted_avg_cost,
       COALESCE(la.stock_value_raw, 0::numeric)::numeric(14,2) AS stock_value,
       COALESCE(la.lots_count, 0::bigint)::integer AS lots_count,
       la.oldest_lot_date,
       la.newest_lot_date,
       CASE WHEN yc.reorder_kg IS NOT NULL AND yc.reorder_kg > 0::numeric
             AND COALESCE(la.available_kg, 0::numeric) < yc.reorder_kg
            THEN true ELSE false END AS below_reorder,
       NULL::numeric AS kg_30d,
       doc.days_of_cover
  FROM public.yarn_count yc
  LEFT JOIN lot_agg la ON la.yarn_count_id = yc.id
  LEFT JOIN public.v_yarn_days_of_cover doc ON doc.yarn_count_code = yc.code;

COMMENT ON VIEW public.v_stock_on_hand IS
  'Per-count yarn position for the mill''s OWN stock (in-house lots only). Vendor-held yarn is fn_stock_by_mode. See migrations 012, 299, 300.';

-- ----------------------------------------------------------------------------
-- Yarn sitting with a jobwork or outsource party, per count.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_stock_by_mode(p_mode text)
RETURNS TABLE (
  yarn_count_id     bigint,
  code              text,
  display_name      text,
  yarn_type         text,
  ne                numeric,
  denier            numeric,
  is_doubled        boolean,
  is_slub           boolean,
  reorder_kg        numeric,
  status            text,
  available_kg      numeric,
  weighted_avg_cost numeric,
  stock_value       numeric,
  lots_count        integer,
  oldest_lot_date   date,
  newest_lot_date   date,
  below_reorder     boolean,
  kg_30d            numeric,
  days_of_cover     numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH bag_agg AS (
    SELECT b.yarn_count_id,
           sum(b.total_kg)         AS available_kg,
           count(*)::int           AS lots_count,
           min(b.given_date)       AS oldest_lot_date,
           max(b.given_date)       AS newest_lot_date
      FROM public.jobwork_weft_bag b
      JOIN public.jobwork_party jp ON jp.id = b.jobwork_party_id
     WHERE jp.kind = p_mode
       AND b.total_kg > 0
       AND COALESCE(b.status, 'active') = 'active'
     GROUP BY b.yarn_count_id
  )
  SELECT yc.id,
         yc.code,
         yc.display_name,
         yc.yarn_type::text,
         yc.ne,
         yc.denier,
         yc.is_doubled,
         yc.is_slub,
         yc.reorder_kg,
         yc.status::text,
         COALESCE(ba.available_kg, 0)::numeric(14,2),
         -- No rate is recorded against a bag given out, so cost and value
         -- are unknown rather than zero.
         NULL::numeric,
         NULL::numeric,
         COALESCE(ba.lots_count, 0),
         ba.oldest_lot_date,
         ba.newest_lot_date,
         -- Reorder is about the mill's own shelf, not the vendor's floor.
         false,
         NULL::numeric,
         NULL::numeric
    FROM public.yarn_count yc
    LEFT JOIN bag_agg ba ON ba.yarn_count_id = yc.id
   WHERE yc.status = 'active'::record_status;
$$;

COMMENT ON FUNCTION public.fn_stock_by_mode(text) IS
  'Per-count yarn held by jobwork or outsource parties, shaped like v_stock_on_hand so one screen can render either. Cost, value and cover are NULL - a bag given out carries no rate. See migration 300.';

-- Verify:
--   select code, available_kg from fn_stock_by_mode('jobwork')
--    where available_kg > 0 order by available_kg desc;
--   -- total should equal fn_stock_on_hand_summary's weft_yarn/jobwork cell
