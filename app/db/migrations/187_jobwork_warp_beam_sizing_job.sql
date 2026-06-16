-- 187_jobwork_warp_beam_sizing_job.sql
--
-- Job Work variant of the Warp Beam given tab needs to record which
-- sizing job each warp was sourced from, but the form is simpler than
-- the outsource pavu-driven flow — no cascading dropdown, no pavu
-- checklist. We just store the picked sizing_job.id as a direct FK on
-- jobwork_warp_beam so the row remembers its source, and so future
-- reports can group by sizing job.
--
-- Nullable: the outsource flow records the sizing job via the linked
-- pavu rows (pavu_id / pavu_ids) so this column stays NULL there. The
-- jobwork flow always fills it.

ALTER TABLE public.jobwork_warp_beam
  ADD COLUMN IF NOT EXISTS sizing_job_id bigint REFERENCES public.sizing_job(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobwork_warp_beam_sizing_job
  ON public.jobwork_warp_beam (sizing_job_id);
