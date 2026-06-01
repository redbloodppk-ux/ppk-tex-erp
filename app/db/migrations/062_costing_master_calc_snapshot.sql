-- 062_costing_master_calc_snapshot.sql
--
-- Adds a single jsonb column that holds the full Calculator state at
-- save time: every input field on /app/costing/new (yarn rates, bobbin
-- price, porvai settings, overheads, profit %, market rate, etc.).
--
-- When the user opens /app/costing/[id] to edit, the page parses this
-- blob and prefills every field of the Calculator UI so the costing
-- can be tweaked end-to-end (not just a few columns).

BEGIN;

ALTER TABLE public.costing_master
  ADD COLUMN IF NOT EXISTS calc_snapshot jsonb;

COMMENT ON COLUMN public.costing_master.calc_snapshot IS
  'Full Quick Calculator input snapshot saved at the time the costing was created/updated. Drives the edit page so every field on the calculator round-trips.';

COMMIT;
