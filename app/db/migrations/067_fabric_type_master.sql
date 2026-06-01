-- 067_fabric_type_master.sql
--
-- Promotes fabric type from a hardcoded UI list to a proper master table
-- so the operator can add new types from Settings -> Fabric Types
-- without a code change. The new master coexists with the existing
-- `fabric_type` pg enum, which costing_master and fabric_quality still
-- use. New rows on fabric_quality must use one of the enum values, so
-- the master is seeded with woven/towel/dupatta to start.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('fabric_type', 'FT', '{prefix}-{seq:0000}', 1, '')
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fabric_type_master (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_doc_type text;
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;
  v_doc_type := CASE TG_TABLE_NAME
    WHEN 'customer'           THEN 'cust'
    WHEN 'employee'           THEN 'emp'
    WHEN 'mill'               THEN 'mill'
    WHEN 'vendor'             THEN 'vendor'
    WHEN 'yarn_count'         THEN 'yc'
    WHEN 'ends_master'        THEN 'ends'
    WHEN 'fabric_quality'     THEN 'fq'
    WHEN 'bobbin'             THEN 'bobbin'
    WHEN 'ledger_type'        THEN 'ledger_type'
    WHEN 'ledger_group'       THEN 'ledger_group'
    WHEN 'ledger'             THEN 'ledger'
    WHEN 'fabric_type_master' THEN 'fabric_type'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fabric_type_master_autogen_code ON public.fabric_type_master;
CREATE TRIGGER trg_fabric_type_master_autogen_code
  BEFORE INSERT ON public.fabric_type_master
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

INSERT INTO public.fabric_type_master (code, name) VALUES
  ('FT-0001', 'Woven'),
  ('FT-0002', 'Towel'),
  ('FT-0003', 'Dupatta')
ON CONFLICT (name) DO NOTHING;

UPDATE public.doc_sequence SET next_value = 4 WHERE doc_type = 'fabric_type' AND next_value < 4;

ALTER TABLE public.fabric_type_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_fabric_type_master_select ON public.fabric_type_master;
CREATE POLICY p_fabric_type_master_select ON public.fabric_type_master FOR SELECT USING (true);
DROP POLICY IF EXISTS p_fabric_type_master_modify ON public.fabric_type_master;
CREATE POLICY p_fabric_type_master_modify ON public.fabric_type_master FOR ALL USING (true) WITH CHECK (true);

COMMIT;
