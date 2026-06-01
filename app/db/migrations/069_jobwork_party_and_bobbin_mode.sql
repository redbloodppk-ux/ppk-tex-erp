-- 069_jobwork_party_and_bobbin_mode.sql
--
-- Adds a Jobwork Party master (same shape as customer but without the
-- customer-specific fields like is_vip and ledger_id) plus two columns
-- on bobbin to capture how each purchase is consumed:
--
--   production_mode  : 'inhouse' (default) | 'jobwork'
--   jobwork_party_id : FK to jobwork_party, required when mode='jobwork'

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('jobwork_party', 'JWP', '{prefix}-{seq:0000}', 1, '')
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.jobwork_party (
  id                  bigserial PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  contact_person      text,
  gstin               text,
  pan                 text,
  phone               text,
  email               text,
  whatsapp            text,
  billing_address     text NOT NULL DEFAULT '',
  shipping_address    text,
  city                text,
  state               text,
  pincode             text,
  payment_terms_days  smallint NOT NULL DEFAULT 30,
  credit_limit        numeric NOT NULL DEFAULT 0,
  notes               text,
  status              public.record_status NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
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
    WHEN 'jobwork_party'      THEN 'jobwork_party'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobwork_party_autogen_code ON public.jobwork_party;
CREATE TRIGGER trg_jobwork_party_autogen_code
  BEFORE INSERT ON public.jobwork_party
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

ALTER TABLE public.jobwork_party ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_jobwork_party_select ON public.jobwork_party;
CREATE POLICY p_jobwork_party_select ON public.jobwork_party FOR SELECT USING (true);
DROP POLICY IF EXISTS p_jobwork_party_modify ON public.jobwork_party;
CREATE POLICY p_jobwork_party_modify ON public.jobwork_party FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS production_mode text NOT NULL DEFAULT 'inhouse',
  ADD COLUMN IF NOT EXISTS jobwork_party_id bigint REFERENCES public.jobwork_party(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bobbin_jobwork_party ON public.bobbin(jobwork_party_id);

COMMENT ON COLUMN public.bobbin.production_mode IS
  'How this bobbin purchase is consumed: inhouse or jobwork.';
COMMENT ON COLUMN public.bobbin.jobwork_party_id IS
  'When production_mode = jobwork, the party that uses these bobbins.';

COMMIT;
