-- 119_jobwork_warp_beam_pavu_link.sql
--
-- Pavu Master's outsource assignments need to flow into the warp-beam-
-- given list on /app/outsource so the operator sees one source of
-- truth. We add a nullable pavu_id link on jobwork_warp_beam:
--
--   - When a pavu row is routed to outsource (Pavu Master / pavu list
--     inline edit), the application UPSERTs a matching
--     jobwork_warp_beam row tagged with that pavu_id.
--   - When the pavu row is routed back to in-house, the application
--     DELETEs the corresponding jobwork_warp_beam row.
--
-- The column is nullable because legacy warp-beam-given rows (entered
-- manually via the Add form) won't have a pavu link.

BEGIN;

ALTER TABLE public.jobwork_warp_beam
  ADD COLUMN IF NOT EXISTS pavu_id bigint REFERENCES public.pavu(id);

-- One warp-beam-given row per pavu — enforced via a partial unique
-- index. Rows without a pavu link are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_jobwork_warp_beam_pavu_id
  ON public.jobwork_warp_beam(pavu_id)
  WHERE pavu_id IS NOT NULL;

COMMENT ON COLUMN public.jobwork_warp_beam.pavu_id IS
  'When set, this warp-beam-given row mirrors an outsource-routed pavu row. Owned by the Pavu Master sync; do not write to it manually.';

COMMIT;
