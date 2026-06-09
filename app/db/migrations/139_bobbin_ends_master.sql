-- 139_bobbin_ends_master.sql
--
-- Catalogues the valid "ends per bobbin" specs (typically 30 / 40 / 60 /
-- 80 / 100). Distinct from the existing ends_master which is for warp
-- ends pinned to a yarn count.
--
-- Used by the in-house bobbin opening stock form: the Ends-per-bobbin
-- field becomes a dropdown sourced from this table's active rows so
-- the operator picks a known value instead of free-typing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bobbin_ends_master (
  id           bigserial PRIMARY KEY,
  ends_count   integer     NOT NULL UNIQUE CHECK (ends_count > 0),
  label        text        NOT NULL,
  active       boolean     NOT NULL DEFAULT true,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        REFERENCES public.app_user(id),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid        REFERENCES public.app_user(id)
);

COMMENT ON TABLE  public.bobbin_ends_master IS 'Catalogue of valid ends-per-bobbin specs. Sourced into the bobbin opening stock form as a dropdown.';
COMMENT ON COLUMN public.bobbin_ends_master.ends_count IS 'Integer ends-per-bobbin (e.g. 30, 40, 60, 80, 100).';
COMMENT ON COLUMN public.bobbin_ends_master.label      IS 'Friendly label shown in dropdowns (e.g. "60 ends/bobbin").';

CREATE INDEX IF NOT EXISTS idx_bobbin_ends_master_active
  ON public.bobbin_ends_master(active, ends_count)
  WHERE active IS TRUE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_bobbin_ends_master_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bobbin_ends_master_touch ON public.bobbin_ends_master;
CREATE TRIGGER trg_bobbin_ends_master_touch
  BEFORE UPDATE ON public.bobbin_ends_master
  FOR EACH ROW EXECUTE FUNCTION public.tg_bobbin_ends_master_touch();

-- RLS: read for all auth users; write only for owner / mill_manager.
ALTER TABLE public.bobbin_ends_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bobbin_ends_master_read  ON public.bobbin_ends_master;
DROP POLICY IF EXISTS bobbin_ends_master_write ON public.bobbin_ends_master;

CREATE POLICY bobbin_ends_master_read
  ON public.bobbin_ends_master
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY bobbin_ends_master_write
  ON public.bobbin_ends_master
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

-- Seed common specs. ON CONFLICT no-ops so re-running is idempotent.
INSERT INTO public.bobbin_ends_master (ends_count, label, active) VALUES
  (30,  '30 ends/bobbin',  true),
  (40,  '40 ends/bobbin',  true),
  (60,  '60 ends/bobbin',  true),
  (80,  '80 ends/bobbin',  true),
  (100, '100 ends/bobbin', true)
ON CONFLICT (ends_count) DO NOTHING;

COMMIT;
