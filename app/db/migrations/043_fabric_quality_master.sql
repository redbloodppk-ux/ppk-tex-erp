-- 043_fabric_quality_master.sql
--
-- Adds a Fabric Quality master so each loom can be tagged with the quality
-- (count/sort/article) it is currently set up for. Replaces the free-text
-- width column in the Looms settings UI; width is now an attribute of the
-- quality, not the loom.
--
-- Tables / columns:
--   * public.fabric_quality (new master)
--   * public.loom.fabric_quality_id (new FK, nullable)
--
-- The legacy loom.width_in column is left in place to avoid breaking older
-- reports; the Looms UI no longer surfaces it.

BEGIN;

CREATE TABLE IF NOT EXISTS public.fabric_quality (
  id               bigserial PRIMARY KEY,
  code             text        NOT NULL UNIQUE,
  name             text        NOT NULL,
  width_in         numeric(8,2),
  weight_gsm       numeric(8,2),
  rate_per_m       numeric(10,2),
  active           boolean     NOT NULL DEFAULT true,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        REFERENCES public.app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid        REFERENCES public.app_user(id)
);

COMMENT ON TABLE  public.fabric_quality IS 'Cloth qualities (count / sort / article) a loom can be set up to weave.';
COMMENT ON COLUMN public.fabric_quality.code        IS 'Short code shown in dropdowns, e.g. ''60s-shirting''.';
COMMENT ON COLUMN public.fabric_quality.width_in    IS 'Reed/loom width for this quality, inches.';
COMMENT ON COLUMN public.fabric_quality.weight_gsm  IS 'Grams per square metre.';
COMMENT ON COLUMN public.fabric_quality.rate_per_m  IS 'Optional reference weaver rate per metre for this quality.';

ALTER TABLE public.loom
  ADD COLUMN IF NOT EXISTS fabric_quality_id bigint
    REFERENCES public.fabric_quality(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_loom_fabric_quality_id
  ON public.loom(fabric_quality_id);

-- updated_at trigger (re-use existing helper if present)
CREATE OR REPLACE FUNCTION public.tg_fabric_quality_touch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fabric_quality_touch ON public.fabric_quality;
CREATE TRIGGER trg_fabric_quality_touch
  BEFORE UPDATE ON public.fabric_quality
  FOR EACH ROW EXECUTE FUNCTION public.tg_fabric_quality_touch();

-- RLS: everyone authenticated can read; only owner/mill_manager can write.
ALTER TABLE public.fabric_quality ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fabric_quality_read  ON public.fabric_quality;
DROP POLICY IF EXISTS fabric_quality_write ON public.fabric_quality;

CREATE POLICY fabric_quality_read
  ON public.fabric_quality
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY fabric_quality_write
  ON public.fabric_quality
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
