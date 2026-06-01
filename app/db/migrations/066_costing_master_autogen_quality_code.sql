-- 066_costing_master_autogen_quality_code.sql
--
-- Auto-generate costing_master.quality_code on INSERT when the operator
-- doesn't supply one. costing_master uses `quality_code` rather than
-- `code`, so the central fn_autogen_code() doesn't fit — we ship a
-- dedicated trigger that calls fn_next_doc_no('costing') and fills the
-- field if it's blank.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('costing', 'COST', '{prefix}-{seq:0000}', 1, '')
ON CONFLICT (doc_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_costing_master_autogen_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quality_code IS NULL OR NEW.quality_code = '' THEN
    NEW.quality_code := public.fn_next_doc_no('costing');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_costing_master_autogen_code ON public.costing_master;
CREATE TRIGGER trg_costing_master_autogen_code
  BEFORE INSERT ON public.costing_master
  FOR EACH ROW EXECUTE FUNCTION public.fn_costing_master_autogen_code();

COMMIT;
