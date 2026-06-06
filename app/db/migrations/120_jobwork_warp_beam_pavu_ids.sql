-- 120_jobwork_warp_beam_pavu_ids.sql
--
-- The "Add warp beam given" form on /app/outsource creates one
-- aggregate jobwork_warp_beam row that represents N pavu beams.
-- Until now we had no way to know which pavus that aggregate
-- referenced — pavu_id is a single FK, not an array.
--
-- Adding pavu_ids as a JSONB array lets the Release action on the
-- warp-given table revert exactly the pavus that were included on
-- save (set their production_mode back to in_house, clear
-- outsource_ledger_id, drop status from 'assigned' back to 'in_stock').
--
-- pavu_id (singular) and pavu_ids (array) coexist:
--   - 1-to-1 mirror rows (created by Pavu Master sync) → pavu_id set,
--     pavu_ids null.
--   - Aggregate rows (from the Add form) → pavu_id null, pavu_ids set.
--
-- Application code should look at whichever is non-null when
-- deciding what to release.

BEGIN;

ALTER TABLE public.jobwork_warp_beam
  ADD COLUMN IF NOT EXISTS pavu_ids jsonb;

COMMENT ON COLUMN public.jobwork_warp_beam.pavu_ids IS
  'JSONB array of pavu.id values represented by this aggregate warp-given row. NULL on 1-to-1 mirror rows (use pavu_id instead).';

COMMIT;
