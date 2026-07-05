-- Jobwork beams arrive pre-sized by an external party — there is no
-- matching row in our own sizing_job table for them. The "Sizing job"
-- dropdown on /app/jobwork's jobwork-kind Add form was copied from the
-- outsource flow and can never be filled in correctly for jobwork
-- entries (jobwork_warp_beam.sizing_job_id, added in migration 187,
-- stays in place for legacy rows but new jobwork entries stop
-- populating it). Replace it with a plain free-text "Sizing Set No"
-- field — same unvalidated free-text pattern as sizing_job.set_no.
--
-- Also added to pavu so the set no is visible downstream on Pavu
-- Master's Jobwork tab and the Loom View jobwork tags without a join
-- back to jobwork_warp_beam.
ALTER TABLE public.jobwork_warp_beam ADD COLUMN IF NOT EXISTS sizing_set_no text;
ALTER TABLE public.pavu             ADD COLUMN IF NOT EXISTS sizing_set_no text;

COMMENT ON COLUMN public.jobwork_warp_beam.sizing_set_no IS 'Free-text sizing set number supplied by the jobwork party. Not validated against sizing_job — jobwork beams are sized externally.';
COMMENT ON COLUMN public.pavu.sizing_set_no IS 'Free-text sizing set number, populated for jobwork-mode pavu rows only. Mirrors jobwork_warp_beam.sizing_set_no for downstream display (Pavu Master, Loom View).';
