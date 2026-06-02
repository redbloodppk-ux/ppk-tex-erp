-- 082_delivery_challan_rebuild.sql
--
-- Rebuilds the Delivery Challan (DC) data model around the unified party
-- master and the existing sales-order / invoice tables. The legacy DC
-- table from an earlier prototype is dropped (it had no rows). The new
-- shape:
--
--   delivery_challan (header)
--     code                  auto DC/26-27/0001 etc via fn_autogen_code
--     production_mode       'inhouse' / 'jobwork'
--     party_id              customer (inhouse) OR jobwork party
--     ship_to_same          true if ship-to == bill-to
--     ship_to_party_id      separate shipping party if not same
--     bill_to_* / ship_to_* snapshot copies of name/address/gstin/state/
--                           state_code so historical DCs print correctly
--                           even if the party master is later edited
--     transport details     vehicle_no, transport_mode, LR no/date,
--                           driver, distance_km
--     totals snapshot       total_metres / pieces / bundles / amount
--     sales_order_id        populated when the Sales Orders page
--                           confirms the DC for invoicing
--     invoice_id            populated when an invoice is generated
--
--   delivery_challan_item (one row per fabric line on the DC)
--     dc_id, sno, fabric_quality_id, description, hsn, metres, pieces,
--     bundles, rate_per_m, amount, notes

BEGIN;

DROP TABLE IF EXISTS public.delivery_challan_item CASCADE;
DROP TABLE IF EXISTS public.delivery_challan      CASCADE;

CREATE TABLE public.delivery_challan (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  dc_date         date NOT NULL DEFAULT CURRENT_DATE,
  status          text NOT NULL DEFAULT 'draft',
  production_mode text NOT NULL DEFAULT 'inhouse',
  party_id        bigint REFERENCES public.party(id) ON DELETE SET NULL,
  ship_to_same    boolean NOT NULL DEFAULT true,
  ship_to_party_id bigint REFERENCES public.party(id) ON DELETE SET NULL,
  bill_to_name    text,
  bill_to_address text,
  bill_to_gstin   text,
  bill_to_state   text,
  bill_to_state_code text,
  ship_to_name    text,
  ship_to_address text,
  ship_to_gstin   text,
  ship_to_state   text,
  ship_to_state_code text,
  vehicle_no      text,
  transport_mode  text,
  lr_no           text,
  lr_date         date,
  driver_name     text,
  driver_phone    text,
  distance_km     numeric(10,2),
  total_metres    numeric(14,2) NOT NULL DEFAULT 0,
  total_pieces    integer       NOT NULL DEFAULT 0,
  total_bundles   integer       NOT NULL DEFAULT 0,
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  sales_order_id  bigint REFERENCES public.sales_order(id) ON DELETE SET NULL,
  invoice_id      bigint REFERENCES public.invoice(id) ON DELETE SET NULL,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid
);

CREATE INDEX idx_dc_party       ON public.delivery_challan(party_id);
CREATE INDEX idx_dc_status      ON public.delivery_challan(status);
CREATE INDEX idx_dc_date        ON public.delivery_challan(dc_date);
CREATE INDEX idx_dc_sales_order ON public.delivery_challan(sales_order_id);

CREATE TABLE public.delivery_challan_item (
  id                bigserial PRIMARY KEY,
  dc_id             bigint NOT NULL REFERENCES public.delivery_challan(id) ON DELETE CASCADE,
  sno               integer NOT NULL,
  fabric_quality_id bigint REFERENCES public.fabric_quality(id) ON DELETE SET NULL,
  description       text,
  hsn               text,
  metres            numeric(12,2),
  pieces            integer,
  bundles           integer,
  rate_per_m        numeric(12,2),
  amount            numeric(14,2),
  notes             text
);

CREATE INDEX idx_dc_item_dc ON public.delivery_challan_item(dc_id);

-- Auto-gen DC codes via the central doc_sequence.
INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('dc', 'DC', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true)
ON CONFLICT (doc_type) DO NOTHING;

-- Patch the central fn_autogen_code to know about delivery_challan.
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
    WHEN 'delivery_challan'   THEN 'dc'
    ELSE NULL
  END;
  IF v_doc_type IS NULL THEN RETURN NEW; END IF;
  NEW.code := fn_next_doc_no(v_doc_type);
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_dc_autogen_code ON public.delivery_challan;
CREATE TRIGGER trg_dc_autogen_code
  BEFORE INSERT ON public.delivery_challan
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_autogen_code();

ALTER TABLE public.delivery_challan      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_challan_item ENABLE ROW LEVEL SECURITY;

CREATE POLICY p_dc_select ON public.delivery_challan FOR SELECT USING (true);
CREATE POLICY p_dc_modify ON public.delivery_challan FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY p_dc_item_select ON public.delivery_challan_item FOR SELECT USING (true);
CREATE POLICY p_dc_item_modify ON public.delivery_challan_item FOR ALL USING (true) WITH CHECK (true);

COMMIT;
