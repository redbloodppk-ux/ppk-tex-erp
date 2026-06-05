-- 113_jobwork_party_kind.sql
--
-- The new /app/outsource page mirrors /app/jobwork but is targeted at
-- Outsource Weaver parties instead of Jobwork Parties. Both pages
-- share the same downstream stock tables (bobbin, jobwork_warp_beam,
-- jobwork_weft_bag, bobbin_return, stock_ledger) because the FKs all
-- target the legacy `jobwork_party` table.
--
-- To distinguish the two flows at query time without changing every
-- FK in the system, we add a `kind` column to jobwork_party:
--
--   * 'jobwork'   → visible on /app/jobwork
--   * 'outsource' → visible on /app/outsource
--
-- Backfill: every existing jobwork_party row stays 'jobwork'.
--
-- A new BEFORE INSERT trigger on `party` mirrors any Outsource Weaver
-- or Jobwork Party row into jobwork_party with the matching kind so
-- the operator can keep managing parties through the unified Parties
-- page at /app/parties.

BEGIN;

ALTER TABLE public.jobwork_party
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'jobwork';

ALTER TABLE public.jobwork_party
  DROP CONSTRAINT IF EXISTS jobwork_party_kind_check;
ALTER TABLE public.jobwork_party
  ADD CONSTRAINT jobwork_party_kind_check
  CHECK (kind IN ('jobwork', 'outsource'));

CREATE INDEX IF NOT EXISTS idx_jobwork_party_kind ON public.jobwork_party(kind);

-- Backfill existing rows: any row already linked to a party tagged
-- 'Outsource Weaver' switches to kind='outsource'. The rest stay
-- 'jobwork' (the default).
UPDATE public.jobwork_party jp
   SET kind = 'outsource'
  FROM public.party p,
       public.party_type_master pt
 WHERE p.name = jp.name
   AND pt.name = 'Outsource Weaver'
   AND pt.id = ANY(p.party_type_ids);

-- Sync trigger: when a Party row with type 'Jobwork Party' or
-- 'Outsource Weaver' is inserted / updated, ensure a matching
-- jobwork_party row exists with the right kind. Insert-only — the
-- jobwork_party row is left alone if it already exists (the operator
-- might have edited it independently).
CREATE OR REPLACE FUNCTION public.fn_party_to_jobwork_party_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
  v_has_jobwork  boolean;
  v_has_outsrc   boolean;
BEGIN
  SELECT
    EXISTS (
      SELECT 1 FROM public.party_type_master pt
       WHERE pt.id = ANY(NEW.party_type_ids) AND pt.name = 'Jobwork Party'
    ),
    EXISTS (
      SELECT 1 FROM public.party_type_master pt
       WHERE pt.id = ANY(NEW.party_type_ids) AND pt.name = 'Outsource Weaver'
    )
  INTO v_has_jobwork, v_has_outsrc;

  -- Pick a kind based on the party's tags. Prefer outsource because
  -- that's the new flow; a party tagged BOTH gets two rows (one of
  -- each kind) so it shows up on both pages.
  IF v_has_outsrc THEN
    v_kind := 'outsource';
    IF NOT EXISTS (
      SELECT 1 FROM public.jobwork_party WHERE name = NEW.name AND kind = v_kind
    ) THEN
      INSERT INTO public.jobwork_party (name, status, kind)
      VALUES (NEW.name, 'active', v_kind);
    END IF;
  END IF;

  IF v_has_jobwork THEN
    v_kind := 'jobwork';
    IF NOT EXISTS (
      SELECT 1 FROM public.jobwork_party WHERE name = NEW.name AND kind = v_kind
    ) THEN
      INSERT INTO public.jobwork_party (name, status, kind)
      VALUES (NEW.name, 'active', v_kind);
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_party_to_jobwork_party_sync ON public.party;
CREATE TRIGGER trg_party_to_jobwork_party_sync
  AFTER INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_party_to_jobwork_party_sync();

-- Apply backfill: for every existing Outsource Weaver party that
-- doesn't yet have a jobwork_party row, create one.
INSERT INTO public.jobwork_party (name, status, kind)
SELECT p.name, 'active', 'outsource'
  FROM public.party p
  JOIN public.party_type_master pt ON pt.id = ANY(p.party_type_ids)
 WHERE pt.name = 'Outsource Weaver'
   AND p.status = 'active'
   AND NOT EXISTS (
     SELECT 1 FROM public.jobwork_party jp
      WHERE jp.name = p.name AND jp.kind = 'outsource'
   );

COMMIT;
