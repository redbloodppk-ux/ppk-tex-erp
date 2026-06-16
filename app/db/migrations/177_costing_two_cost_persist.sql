-- 177_costing_two_cost_persist.sql
--
-- The Fabric Costing list page, the variance dashboard, and the
-- batch-snapshot trigger all read from a view called
-- `v_costing_two_cost` (quoted_cost_per_m, true_cost_per_m). That view
-- was REFERENCED across the codebase but never actually CREATED — see
-- the comment in migration 146 ("v_costing_two_cost / v_costing_computed
-- which were never created"). Consequence: the list always shows "-"
-- for both cost columns.
--
-- Fix:
--   1. Persist the two per-metre cost numbers directly on
--      `costing_master` (the form already computes them — we just need
--      to store them).
--   2. Create the view as a thin wrapper so every existing consumer
--      keeps working unchanged.
--
-- "Quoted" = what we'd charge a customer (= subtotal + profit, but
--   since the Profit & Market section was removed, it equals the
--   pure cost-per-m the calculator shows).
-- "True"   = mill's actual cost. For now it's the same number as
--   quoted; once LOOMS overhead per metre is wired in, true_cost_per_m
--   will be quoted + LOOMS overhead. The split is preserved here so
--   the rest of the schema is forward-compatible.
--
-- The forms are updated in the same commit to start populating these
-- columns on insert / update. Existing rows show "-" until the
-- operator opens and re-saves them.

BEGIN;

ALTER TABLE public.costing_master
  ADD COLUMN IF NOT EXISTS quoted_cost_per_m numeric(12,2),
  ADD COLUMN IF NOT EXISTS true_cost_per_m   numeric(12,2);

COMMENT ON COLUMN public.costing_master.quoted_cost_per_m IS
  'Calculator''s computed cost-per-metre (customer-facing). Persisted at save time.';
COMMENT ON COLUMN public.costing_master.true_cost_per_m IS
  'Mill''s actual per-metre cost. Currently mirrors quoted; once LOOMS overhead is wired in, this becomes quoted + LOOMS overhead.';

DROP VIEW IF EXISTS public.v_costing_two_cost CASCADE;
CREATE VIEW public.v_costing_two_cost
WITH (security_invoker=on) AS
SELECT
  cm.id,
  cm.quality_code,
  cm.quality_name,
  cm.quoted_cost_per_m::numeric(12,2)                        AS quoted_cost_per_m,
  COALESCE(cm.true_cost_per_m, cm.quoted_cost_per_m)::numeric(12,2) AS true_cost_per_m,
  /* Pass through commonly-joined fields so existing consumers don't
     need to additionally join costing_master separately. */
  cm.sizing_cost_per_m,
  cm.warp_m_per_kg,
  cm.weft_m_per_kg,
  cm.grams_per_m,
  cm.gsm
FROM public.costing_master cm;

COMMENT ON VIEW public.v_costing_two_cost IS
  'Per-costing quoted vs true cost-per-metre. Thin wrapper over costing_master after migration 177 added the persisted columns.';

COMMIT;
