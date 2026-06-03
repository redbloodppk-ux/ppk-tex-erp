-- 088_fix_autogen_for_fabric_receipt.sql
--
-- fn_autogen_code crashed on fabric_receipt inserts with
-- "record 'new' has no field 'production_mode'". The CASE branch for
-- delivery_challan touched NEW.production_mode directly and PL/pgSQL
-- resolved the field eagerly against the current trigger's record type.
-- fabric_receipt doesn't have that column, so the trigger blew up.
--
-- Fix: move the production_mode check out of the CASE expression into a
-- guarded IF block, and access the field via to_jsonb(NEW)->>'...' so
-- the lookup is deferred to runtime against the actual row contents.

CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
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
    WHEN 'jobwork_party'      THEN 'jobwork_party'
    WHEN 'party_type_master'  THEN 'party_type'
    WHEN 'party'              THEN 'party'
    WHEN 'fabric_receipt'     THEN 'fabric_receipt'
    WHEN 'delivery_challan'   THEN 'dc'  -- conditional override below
    ELSE NULL
  END;

  -- Jobwork DCs get a different prefix. Done outside the CASE so the
  -- production_mode field is only touched when the trigger fires on
  -- delivery_challan (where the column actually exists). Going via
  -- to_jsonb(NEW)->>'production_mode' makes the lookup string-based at
  -- runtime, so PL/pgSQL doesn't try to resolve the field statically.
  IF TG_TABLE_NAME = 'delivery_challan'
     AND COALESCE(to_jsonb(NEW)->>'production_mode', 'inhouse') = 'jobwork' THEN
    v_doc_type := 'jobwork_dc';
  END IF;

  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $function$;
