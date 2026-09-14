-- ============================================================================
-- 299: Yarn that went to the sizing mill is not yarn on PPK's shelf.
--
-- PPK, 2026-09-14, on the Yarn & Suppliers page: "SHOW ONLY IN HOUSE ONLY
-- here".
--
-- yarn_lot.delivery_destination says where a lot was delivered:
--   in_house  16 lots  the bales that actually arrive at the mill
--   sizing     5 lots  bought and sent straight to the sizing mill
--
-- A sizing lot never reaches the yarn store. Counting it as stock on hand
-- says PPK has yarn he cannot touch. v_yarn_days_of_cover counted both.
--
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
-- The destination filter moves into the JOIN condition rather than a WHERE
-- clause. That matters: put in WHERE it would drop C-30 and C-40 out of the
-- view altogether, since every lot of those two counts goes to sizing, and
-- the Stock On Hand report would silently lose two counts from its cover
-- column. In the JOIN it just zeroes their on-hand instead, which is the
-- truth - PPK holds none of either.
--
-- NO FIGURE MOVES TODAY. All five sizing lots already sit at current_kg = 0,
-- having been consumed. This is preventive: the next sizing lot bought would
-- otherwise have shown up as stock in hand the day it was entered.
--
-- STILL WRONG, AND NOT FIXED HERE: days_of_cover is on_hand_kg / 30.0. That
-- is not cover - it assumes every count is consumed at exactly 30 kg a day,
-- whatever it is and whatever the looms are running. It has been that way
-- since migration 147. Flagged to PPK rather than guessed at, because a real
-- figure needs actual consumption per count and that is a decision about
-- which window to measure.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_yarn_days_of_cover AS
WITH lot_summary AS (
  SELECT yc.code AS yarn_count_code,
         COALESCE(sum(yl.current_kg), 0::numeric) AS on_hand_kg,
         COALESCE(avg(NULLIF(yl.cost_per_kg, 0::numeric)), 0::numeric) AS avg_cost_per_kg
    FROM public.yarn_count yc
    -- The filter belongs here, not in WHERE: a count whose every lot went
    -- to sizing must still appear, reading zero.
    LEFT JOIN public.yarn_lot yl
           ON yl.yarn_count_id = yc.id
          AND COALESCE(yl.delivery_destination, 'in_house') = 'in_house'
   WHERE yc.status = 'active'::record_status
   GROUP BY yc.code
)
SELECT yarn_count_code,
       on_hand_kg,
       avg_cost_per_kg,
       CASE WHEN on_hand_kg > 0::numeric THEN on_hand_kg / 30.0
            ELSE 0::numeric END AS days_of_cover
  FROM lot_summary;

COMMENT ON VIEW public.v_yarn_days_of_cover IS
  'On-hand kg and cover per active yarn count, counting IN-HOUSE lots only - yarn delivered straight to the sizing mill never reaches the store. See migration 299.';

-- Verify: the two sizing-only counts read zero, and the shelf is unchanged.
--   select yarn_count_code, on_hand_kg from v_yarn_days_of_cover
--    where on_hand_kg > 0 order by on_hand_kg desc;
--   -- expect C-40CD 545.79 and P-150D 25.10 only
