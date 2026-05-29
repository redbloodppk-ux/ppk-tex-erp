-- 044_ends_master.sql
--
-- Adds an Ends Master so the mill can catalogue standard warp-end specs
-- (e.g. 60-ends, 80-ends, 100-ends). Today the integer "ends" count lives
-- as a column on pavu, bobbin (ends_per_bobbin), and costing (warp_ends /
-- selvedge_ends) with no shared lookup. This master gives a single place
-- to define the common end-counts so future bobbin / pavu / costing forms
-- can pick from a dropdown instead of free-typing an integer.
--
-- Table:
--   * public.ends_master (new master)
--
-- No foreign keys are added to existing tables yet — this migration is
-- additive and non-breaking; consumers can opt in later.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ends_master (
  id               bigserial PRIMARY KEY,
  code             text        NOT NULL UNIQUE,
  ends_count       integer     NOT NULL CHECK (ends_count > 0),
  name             text        NOT NULL,
  active           boolean     NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        REFERENCES public.app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        REFERENCES public.app_user(id)
);

COMMENT ON TABLE  public.ends_master IS 'Master of standard warp-end specs reused across bobbin / pavu / costing.';
COMMENT ON COLUMN public.ends_master.code        IS 'Short code shown in dropdowns, e.g. ''E60'' or ''60-ends''.';
COMMENT ON COLUMN public.ends_master.ends_count  IS 'Integer ends count, e.g. 60, 80, 100.';
COMMENT ON COLUMN public.ends_master.name        IS 'Friendly display name, e.g. ''60 Ends (standard shirting)''.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_ends_master_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ends_master_touch ON public.ends_master;
CREATE TRIGGER trg_ends_master_touch
  BEFORE UPDATE ON public.ends_master
  FOR EACH ROW EXECUTE FUNCTION public.tg_ends_master_touch();

-- RLS: everyone authenticated can read; only owner/mill_manager can write.
ALTER TABLE public.ends_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ends_master_read  ON public.ends_master;
DROP POLICY IF EXISTS ends_master_write ON public.ends_master;

CREATE POLICY ends_master_read
  ON public.ends_master
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY ends_master_write
  ON public.ends_master
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.app_user u
      WHERE u.id = auth.uid() AND u.role IN ('owner','mill_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.app_user u
      WHERE u.id = auth.uid() AND u.role IN ('owner','mill_manager')
    )
  );

COMMIT;
