-- 049_bobbin_autogen_code.sql
--
-- Bobbin is now a purchase log, so the same spec can be bought many
-- times. The previous client-built code "BB-{ends}-{metres}" clashes
-- on bobbin_code_key. Switch to a sequential BB-NNNN code generated
-- server-side via the existing fn_autogen_code() trigger.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('bobbin', 'BB', '{prefix}-{seq:0000}', '', 1, false)
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
    WHEN 'bobbin'         THEN 'bobbin'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bobbin_autogen_code ON public.bobbin;
CREATE TRIGGER trg_bobbin_autogen_code
  BEFORE INSERT ON public.bobbin
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

COMMIT;
