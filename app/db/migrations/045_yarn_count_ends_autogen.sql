-- 045_yarn_count_ends_autogen.sql
--
-- 1) Adds doc_sequence rows for yarn_count + ends_master so codes are
--    auto-generated server-side (same pattern as customer / mill / vendor).
-- 2) Extends fn_autogen_code() with branches for those two tables.
-- 3) Adds the BEFORE INSERT triggers.
-- 4) Adds ends_master.count_id (FK to yarn_count) so each ends spec can be
--    pinned to a specific yarn count, per the UI redesign.
--
-- Codes:
--   yc   → YC-NNNN (e.g. YC-0001)
--   ends → EN-NNNN (e.g. EN-0001)

BEGIN;

-- 1) doc_sequence rows ---------------------------------------------------
INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES
  ('yc',   'YC', '{prefix}-{seq:0000}', '', 1, false),
  ('ends', 'EN', '{prefix}-{seq:0000}', '', 1, false)
ON CONFLICT (doc_type) DO NOTHING;

-- 2) Extend the autogen function. Replace with the updated CASE list.
CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_doc_type text;
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN
    RETURN NEW;
  END IF;

  v_doc_type := CASE TG_TABLE_NAME
    WHEN 'customer'     THEN 'cust'
    WHEN 'employee'     THEN 'emp'
    WHEN 'mill'         THEN 'mill'
    WHEN 'vendor'       THEN 'vendor'
    WHEN 'yarn_count'   THEN 'yc'
    WHEN 'ends_master'  THEN 'ends'
    ELSE NULL
  END;

  IF v_doc_type IS NULL THEN
    RETURN NEW;
  END IF;

  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END;
$function$;

-- 3) Triggers
DROP TRIGGER IF EXISTS trg_yarn_count_autogen_code ON public.yarn_count;
CREATE TRIGGER trg_yarn_count_autogen_code
  BEFORE INSERT ON public.yarn_count
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

DROP TRIGGER IF EXISTS trg_ends_master_autogen_code ON public.ends_master;
CREATE TRIGGER trg_ends_master_autogen_code
  BEFORE INSERT ON public.ends_master
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

-- 4) ends_master.count_id FK
ALTER TABLE public.ends_master
  ADD COLUMN IF NOT EXISTS count_id bigint
    REFERENCES public.yarn_count(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ends_master_count_id
  ON public.ends_master(count_id);

COMMENT ON COLUMN public.ends_master.count_id
  IS 'Optional FK to yarn_count: which yarn count this ends spec is for.';

COMMIT;
