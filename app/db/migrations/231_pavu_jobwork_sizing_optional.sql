-- 231_pavu_jobwork_sizing_optional.sql
--
-- Jobwork beams (production_mode = 'jobwork') are now created directly by
-- the beam-wise "Warp beam given" form on /app/jobwork, one pavu row per
-- physical beam supplied by the jobwork party. These beams have no sizing
-- job — the mill didn't size them, the party delivered a ready-made beam —
-- so pavu.sizing_job_id (previously NOT NULL) must become optional.
--
-- Also repurposes pavu.jobwork_ledger_id (added in migration 230): it
-- previously meant "the jobwork_party this beam was routed OUT to" (mirroring
-- outsource). It now means "the jobwork_party that SUPPLIED this beam" — the
-- inbound direction is the only real jobwork flow at this mill. No column or
-- type change needed, only the meaning + the comment below.

ALTER TABLE public.pavu ALTER COLUMN sizing_job_id DROP NOT NULL;

COMMENT ON COLUMN public.pavu.jobwork_ledger_id IS
  'Set when production_mode = jobwork: the jobwork_party.ledger_id (kind=jobwork) that SUPPLIED this beam for in-house weaving. The mill mounts the beam on its own loom and delivers finished fabric back to this party via a DC + job-work invoice. (Repurposed by migration 231 — previously meant the party the beam was sent OUT to, mirroring outsource; that direction turned out not to reflect how jobwork actually works at this mill.)';
