-- 071_party_master.sql
--
-- Unified party master. One table for every business you transact with —
-- customers, mills, jobwork parties, sizing parties, outsource weavers,
-- bobbin suppliers, anything. Each row is tagged with a party_type
-- (FK to party_type_master) so the same dropdown can power Sales Orders
-- (filter by Customer), Bobbin Stock (filter by Bobbin Supplier), Jobwork
-- (filter by Jobwork), etc.
--
-- The legacy customer / mill / jobwork_party tables stay in place for
-- backward compatibility with existing FK references. Data can be copied
-- across later with a separate migration.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('party_type', 'PT', '{prefix}-{seq:0000}', 1, '')
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('party', 'PRT', '{prefix}-{seq:0000}', 1, '')
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.party_type_master (
  id          bigserial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.party (
  id                  bigserial PRIMARY KEY,
  code                text NOT NULL UNIQUE,
  party_type_id       bigint REFERENCES public.party_type_master(id) ON DELETE SET NULL,
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
  is_vip              boolean NOT NULL DEFAULT false,
  notes               text,
  status              public.record_status NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS idx_party_type   ON public.party(party_type_id);
CREATE INDEX IF NOT EXISTS idx_party_status ON public.party(status);
CREATE INDEX IF NOT EXISTS idx_party_gstin  ON public.party(gstin) WHERE gstin IS NOT NULL;

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
    WHEN 'party_type_master'  THEN 'party_type'
    WHEN 'party'              THEN 'party'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_party_type_master_autogen_code ON public.party_type_master;
CREATE TRIGGER trg_party_type_master_autogen_code
  BEFORE INSERT ON public.party_type_master
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

DROP TRIGGER IF EXISTS trg_party_autogen_code ON public.party;
CREATE TRIGGER trg_party_autogen_code
  BEFORE INSERT ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

INSERT INTO public.party_type_master (code, name) VALUES
  ('PT-0001', 'Customer'),
  ('PT-0002', 'Mill / Yarn Supplier'),
  ('PT-0003', 'Jobwork Party'),
  ('PT-0004', 'Sizing Party'),
  ('PT-0005', 'Outsource Weaver'),
  ('PT-0006', 'Bobbin Supplier'),
  ('PT-0007', 'Broker / Agent')
ON CONFLICT (name) DO NOTHING;

UPDATE public.doc_sequence SET next_value = 8
WHERE doc_type = 'party_type' AND next_value < 8;

ALTER TABLE public.party_type_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_party_type_master_select ON public.party_type_master;
CREATE POLICY p_party_type_master_select ON public.party_type_master FOR SELECT USING (true);
DROP POLICY IF EXISTS p_party_type_master_modify ON public.party_type_master;
CREATE POLICY p_party_type_master_modify ON public.party_type_master FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.party ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_party_select ON public.party;
CREATE POLICY p_party_select ON public.party FOR SELECT USING (true);
DROP POLICY IF EXISTS p_party_modify ON public.party;
CREATE POLICY p_party_modify ON public.party FOR ALL USING (true) WITH CHECK (true);

COMMIT;
