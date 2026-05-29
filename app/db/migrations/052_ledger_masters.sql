-- 052_ledger_masters.sql
--
-- Three masters for accounting: ledger_type, ledger_group, ledger.
-- Auto-codes via fn_autogen_code() (LT-NNNN, LG-NNNN, LED-NNNN).
-- Seeds the 10 ledger types and 19 account groups found in the uploaded
-- ledger.xlsx so the dropdowns are usable from day one.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ledger_type (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_user(id)
);

CREATE TABLE IF NOT EXISTS public.ledger_group (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL UNIQUE,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_user(id)
);

CREATE TABLE IF NOT EXISTS public.ledger (
  id         bigserial PRIMARY KEY,
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  type_id    bigint NOT NULL REFERENCES public.ledger_type(id)  ON DELETE RESTRICT,
  group_id   bigint NOT NULL REFERENCES public.ledger_group(id) ON DELETE RESTRICT,
  address1   text,
  address2   text,
  address3   text,
  address4   text,
  phone      text,
  email      text,
  pan_no     text,
  gstin      text,
  area       text,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_ledger_type_id    ON public.ledger(type_id);
CREATE INDEX IF NOT EXISTS idx_ledger_group_id   ON public.ledger(group_id);
CREATE INDEX IF NOT EXISTS idx_ledger_name       ON public.ledger(name);

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES
  ('ledger_type',  'LT',  '{prefix}-{seq:0000}', '', 1, false),
  ('ledger_group', 'LG',  '{prefix}-{seq:0000}', '', 1, false),
  ('ledger',       'LED', '{prefix}-{seq:0000}', '', 1, false)
ON CONFLICT (doc_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_autogen_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
    WHEN 'ledger_type'    THEN 'ledger_type'
    WHEN 'ledger_group'   THEN 'ledger_group'
    WHEN 'ledger'         THEN 'ledger'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ledger_type_autogen_code  ON public.ledger_type;
DROP TRIGGER IF EXISTS trg_ledger_group_autogen_code ON public.ledger_group;
DROP TRIGGER IF EXISTS trg_ledger_autogen_code       ON public.ledger;
CREATE TRIGGER trg_ledger_type_autogen_code  BEFORE INSERT ON public.ledger_type  FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();
CREATE TRIGGER trg_ledger_group_autogen_code BEFORE INSERT ON public.ledger_group FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();
CREATE TRIGGER trg_ledger_autogen_code       BEFORE INSERT ON public.ledger       FOR EACH ROW EXECUTE FUNCTION public.fn_autogen_code();

CREATE OR REPLACE FUNCTION public.tg_ledger_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_ledger_type_touch  ON public.ledger_type;
DROP TRIGGER IF EXISTS trg_ledger_group_touch ON public.ledger_group;
DROP TRIGGER IF EXISTS trg_ledger_touch       ON public.ledger;
CREATE TRIGGER trg_ledger_type_touch  BEFORE UPDATE ON public.ledger_type  FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_touch();
CREATE TRIGGER trg_ledger_group_touch BEFORE UPDATE ON public.ledger_group FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_touch();
CREATE TRIGGER trg_ledger_touch       BEFORE UPDATE ON public.ledger       FOR EACH ROW EXECUTE FUNCTION public.tg_ledger_touch();

DO $$
DECLARE t text;
BEGIN
  FOR t IN VALUES ('ledger_type'), ('ledger_group'), ('ledger') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_read  ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_write ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_read ON public.%I FOR SELECT TO authenticated USING (true)', t, t);
    EXECUTE format('CREATE POLICY %I_write ON public.%I FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM public.app_user u WHERE u.id = auth.uid() AND u.role IN (''owner'',''accounts''))) WITH CHECK (EXISTS (SELECT 1 FROM public.app_user u WHERE u.id = auth.uid() AND u.role IN (''owner'',''accounts'')))', t, t);
  END LOOP;
END$$;

-- Seed values lifted from the uploaded ledger.xlsx.
INSERT INTO public.ledger_type (name) VALUES
  ('SUPPLIER'), ('CUSTOMER'), ('TAX'), ('AGENT'), ('BANK'),
  ('SIZING(VENDOR)'), ('WEAVING(VENDOR)'), ('CASH'), ('TRANSPORT'), ('WAREHOUSE')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.ledger_group (name) VALUES
  ('SUNDRY CREDITORS'), ('SUNDRY DEBTORS'), ('INDIRECT EXPENSES'),
  ('DUTIES & TAXES'), ('DIRECT EXPENSES'), ('BANK ACCOUNTS'),
  ('INDIRECT INCOMES'), ('DIRECT INCOMES'), ('LOANS & ADVANCES (ASSET)'),
  ('LOANS (LIABILITY)'), ('SALES ACCOUNTS'), ('CASH-IN-HAND'),
  ('BANK OD A/C'), ('SUSPENSE A/C'), ('JOBWORK'),
  ('STOCK-IN-HAND'), ('INVESTMENTS'), ('PROFIT & LOSS A/C'),
  ('PURCHASE ACCOUNTS')
ON CONFLICT (name) DO NOTHING;

COMMIT;
