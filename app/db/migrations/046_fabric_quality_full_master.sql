-- 046_fabric_quality_full_master.sql
--
-- Replaces the simple fabric_quality master with the full Smart-style
-- master (see screenshot). Adds the header attributes plus four child
-- tables (ends, warp count, weft, weaving rate). Existing fabric_quality
-- rows are wiped per user request - downstream FKs (loom.fabric_quality_id
-- etc.) cascade.

BEGIN;

TRUNCATE public.fabric_quality CASCADE;

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS quality_for_sales text,
  ADD COLUMN IF NOT EXISTS hsn               text,
  ADD COLUMN IF NOT EXISTS pick_per_inch     numeric(8,2),
  ADD COLUMN IF NOT EXISTS reed              numeric(8,2),
  ADD COLUMN IF NOT EXISTS reed_space        numeric(8,2),
  ADD COLUMN IF NOT EXISTS meter_per_pc      numeric(10,2),
  ADD COLUMN IF NOT EXISTS output_unit       text,
  ADD COLUMN IF NOT EXISTS output_value      numeric(10,2),
  ADD COLUMN IF NOT EXISTS crimp_pct         numeric(6,3),
  ADD COLUMN IF NOT EXISTS gst_pct           numeric(5,2);

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('fq', 'FQ', '{prefix}-{seq:0000}', '', 1, false)
ON CONFLICT (doc_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_doc_type text;
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;
  v_doc_type := CASE TG_TABLE_NAME
    WHEN 'customer'       THEN 'cust'
    WHEN 'employee'       THEN 'emp'
    WHEN 'mill'           THEN 'mill'
    WHEN 'vendor'         THEN 'vendor'
    WHEN 'yarn_count'     THEN 'yc'
    WHEN 'ends_master'    THEN 'ends'
    WHEN 'fabric_quality' THEN 'fq'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fabric_quality_autogen_code ON public.fabric_quality;
CREATE TRIGGER trg_fabric_quality_autogen_code
  BEFORE INSERT ON public.fabric_quality
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

CREATE TABLE IF NOT EXISTS public.fabric_quality_ends (
  id                bigserial PRIMARY KEY,
  fabric_quality_id bigint NOT NULL REFERENCES public.fabric_quality(id) ON DELETE CASCADE,
  sno               int    NOT NULL,
  ends_id           bigint REFERENCES public.ends_master(id) ON DELETE RESTRICT,
  UNIQUE (fabric_quality_id, sno)
);

CREATE TABLE IF NOT EXISTS public.fabric_quality_warp_count (
  id                bigserial PRIMARY KEY,
  fabric_quality_id bigint NOT NULL REFERENCES public.fabric_quality(id) ON DELETE CASCADE,
  sno               int    NOT NULL,
  yarn_count_id     bigint REFERENCES public.yarn_count(id) ON DELETE RESTRICT,
  UNIQUE (fabric_quality_id, sno)
);

CREATE TABLE IF NOT EXISTS public.fabric_quality_weft (
  id                  bigserial PRIMARY KEY,
  fabric_quality_id   bigint NOT NULL REFERENCES public.fabric_quality(id) ON DELETE CASCADE,
  sno                 int    NOT NULL,
  yarn_count_id       bigint REFERENCES public.yarn_count(id) ON DELETE RESTRICT,
  wgt_per_mtr_actual  numeric(10,3),
  meter_per_kg        numeric(10,3),
  wgt_per_mtr_manual  numeric(10,3),
  UNIQUE (fabric_quality_id, sno)
);

CREATE TABLE IF NOT EXISTS public.fabric_quality_weaving_rate (
  id                bigserial PRIMARY KEY,
  fabric_quality_id bigint NOT NULL REFERENCES public.fabric_quality(id) ON DELETE CASCADE,
  sno               int    NOT NULL,
  fabric_type       text,
  rate_per_meter    numeric(10,2),
  UNIQUE (fabric_quality_id, sno)
);

-- RLS: read for all auth users; write for owner / mill_manager only.
DO $$
DECLARE t text;
BEGIN
  FOR t IN VALUES ('fabric_quality_ends'), ('fabric_quality_warp_count'),
                  ('fabric_quality_weft'), ('fabric_quality_weaving_rate') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read  ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (true)',
      t, t);
    EXECUTE format(
      'CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.app_user u WHERE u.id = auth.uid() AND u.role IN (''owner'',''mill_manager''))) WITH CHECK (EXISTS (SELECT 1 FROM public.app_user u WHERE u.id = auth.uid() AND u.role IN (''owner'',''mill_manager'')))',
      t, t);
  END LOOP;
END$$;

COMMIT;
