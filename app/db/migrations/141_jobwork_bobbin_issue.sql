-- 141_jobwork_bobbin_issue.sql
--
-- Dedicated event log for bobbins issued to a jobwork / outsource party.
-- Mirrors jobwork_warp_beam and jobwork_weft_bag so all three "given to
-- party" tables follow the same shape.
--
-- Before migration 140 the bobbin master itself was overloaded with
-- jobwork-issue rows (production_mode='jobwork', jobwork_party_id set).
-- Now that the bobbin master is 1:1 with bobbin_ends_master, every
-- issue event needs its own row in this table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.jobwork_bobbin_issue (
  id                bigserial PRIMARY KEY,
  jobwork_party_id  bigint  NOT NULL REFERENCES public.jobwork_party(id),
  bobbin_id         bigint  NOT NULL REFERENCES public.bobbin(id),
  issue_date        date    NOT NULL DEFAULT CURRENT_DATE,
  -- pieces_issued = current outstanding (decremented by consumption /
  -- bobbin_return). original_pieces is the issued total at the time the
  -- row was created and never moves, so the history list keeps showing
  -- "10 pcs issued" even after 7 are returned.
  pieces_issued     numeric(10,2) NOT NULL DEFAULT 0,
  original_pieces   numeric(10,2),
  supplier_party_id bigint,
  reference_no      text,
  notes             text,
  status            public.record_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES public.app_user(id),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid REFERENCES public.app_user(id)
);

COMMENT ON TABLE  public.jobwork_bobbin_issue IS 'One row per bobbin-issue event to a jobwork/outsource party. Mirrors jobwork_warp_beam / jobwork_weft_bag.';
COMMENT ON COLUMN public.jobwork_bobbin_issue.pieces_issued   IS 'Outstanding pieces with the party. Reduced by consumption / bobbin_return.';
COMMENT ON COLUMN public.jobwork_bobbin_issue.original_pieces IS 'Snapshot of pieces at issue time; never changes after creation.';
COMMENT ON COLUMN public.jobwork_bobbin_issue.supplier_party_id IS 'Optional: the bobbin supplier we bought these from. Used to default the return target.';

CREATE INDEX IF NOT EXISTS idx_jw_bobbin_issue_party    ON public.jobwork_bobbin_issue(jobwork_party_id);
CREATE INDEX IF NOT EXISTS idx_jw_bobbin_issue_bobbin   ON public.jobwork_bobbin_issue(bobbin_id);
CREATE INDEX IF NOT EXISTS idx_jw_bobbin_issue_date     ON public.jobwork_bobbin_issue(issue_date);
CREATE INDEX IF NOT EXISTS idx_jw_bobbin_issue_active   ON public.jobwork_bobbin_issue(status) WHERE status = 'active';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_jw_bobbin_issue_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_jw_bobbin_issue_touch ON public.jobwork_bobbin_issue;
CREATE TRIGGER trg_jw_bobbin_issue_touch
  BEFORE UPDATE ON public.jobwork_bobbin_issue
  FOR EACH ROW EXECUTE FUNCTION public.tg_jw_bobbin_issue_touch();

-- RLS: read for any auth user; write for owner / mill_manager only.
ALTER TABLE public.jobwork_bobbin_issue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jw_bobbin_issue_read  ON public.jobwork_bobbin_issue;
DROP POLICY IF EXISTS jw_bobbin_issue_write ON public.jobwork_bobbin_issue;

CREATE POLICY jw_bobbin_issue_read
  ON public.jobwork_bobbin_issue FOR SELECT TO authenticated USING (true);

CREATE POLICY jw_bobbin_issue_write
  ON public.jobwork_bobbin_issue FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_user u
                  WHERE u.id = auth.uid() AND u.role IN ('owner','mill_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_user u
                       WHERE u.id = auth.uid() AND u.role IN ('owner','mill_manager')));

COMMIT;
