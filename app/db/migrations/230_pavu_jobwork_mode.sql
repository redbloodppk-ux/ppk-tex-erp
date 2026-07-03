-- 230_pavu_jobwork_mode.sql
--
-- Adds a third pavu production_mode: 'jobwork'. This lets Pavu Master
-- route a beam to a plain Jobwork party (kind='jobwork' in
-- jobwork_party), exactly the way 'outsource' already routes a beam to
-- an Outsource Weaver party via outsource_ledger_id.
--
-- New column jobwork_ledger_id mirrors outsource_ledger_id: it stores
-- the jobwork_party.ledger_id of the party the beam is given to. No
-- CHECK constraint is added requiring it — the live pavu table has no
-- such constraint for outsource_ledger_id either (verified against the
-- current schema), so this stays consistent with the existing pattern:
-- enforcement is at the application layer (Pavu Master's mode editor
-- and the Jobwork warp-given save path), not the database.
--
-- Enum values BEFORE: in_house, outsource
-- Enum values AFTER : in_house, outsource, jobwork
--
-- NOTE: ALTER TYPE ... ADD VALUE is kept as a standalone top-level
-- statement (no surrounding BEGIN/COMMIT), matching migration 125's
-- precedent, since the new value must not be referenced in the same
-- transaction it's created in.

ALTER TYPE public.pavu_production_mode ADD VALUE IF NOT EXISTS 'jobwork';

ALTER TABLE public.pavu
  ADD COLUMN IF NOT EXISTS jobwork_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pavu_jobwork_ledger ON public.pavu(jobwork_ledger_id);

COMMENT ON COLUMN public.pavu.jobwork_ledger_id IS
  'Set when production_mode = jobwork: the jobwork_party.ledger_id (kind=jobwork) this beam is given to. Mirrors outsource_ledger_id for the outsource mode.';
