-- 123_outsource_party_prefix.sql
--
-- Jobwork parties and outsource weavers both live on the
-- `jobwork_party` table (differentiated by `kind`), but until now
-- both got the same code prefix `JWP/...`. The mill wants the two
-- series separated:
--
--   kind = 'jobwork'   → JWP/26-27/NNNN
--   kind = 'outsource' → OWP/26-27/NNNN   (Outsource Weaving Party)
--
-- Add a new doc_sequence row for the outsource prefix and teach
-- fn_autogen_code to route by `jobwork_party.kind`.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code, reset_yearly)
VALUES ('outsource_party', 'OWP', '{prefix}/{fy}/{seq:0000}', 1, '26-27', true)
ON CONFLICT (doc_type) DO NOTHING;

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
    WHEN 'jobwork_party'      THEN 'jobwork_party'   -- overridden below by kind
    WHEN 'party_type_master'  THEN 'party_type'
    WHEN 'party'              THEN 'party'
    WHEN 'fabric_receipt'     THEN 'fabric_receipt'
    WHEN 'delivery_challan'   THEN 'dc'              -- overridden below by production_mode
    ELSE NULL
  END;

  -- Jobwork / outsource DC prefix routing — kept from migration 088.
  IF TG_TABLE_NAME = 'delivery_challan' THEN
    DECLARE pm text;
    BEGIN
      pm := COALESCE(to_jsonb(NEW)->>'production_mode', 'inhouse');
      IF pm = 'jobwork' THEN
        v_doc_type := 'jobwork_dc';
      ELSIF pm = 'outsource' THEN
        v_doc_type := 'outsource_dc';
      END IF;
    END;
  END IF;

  -- New: jobwork_party prefix routing by `kind`.
  IF TG_TABLE_NAME = 'jobwork_party' THEN
    IF COALESCE(to_jsonb(NEW)->>'kind', 'jobwork') = 'outsource' THEN
      v_doc_type := 'outsource_party';
    END IF;
  END IF;

  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $function$;

COMMIT;
