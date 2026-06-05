-- 110_fabric_purchase.sql
--
-- Fabric Stock — purchase log of every fabric batch bought from a
-- supplier. Sits as a tab alongside Yarn / Porvai / Bobbin under the
-- In-house Stock page, and replaces the retired Resale page.
--
-- The table mirrors `yarn_lot` but for fabric:
--   * fabric_quality_id replaces yarn_count_id
--   * received_metres   replaces received_kg
--   * a rate_unit ('m' | 'pcs') dropdown lets the operator say
--     whether the price is per metre or per piece. The matching
--     quantity_pieces column is filled when rate is per-piece so we
--     can compute a total cleanly.
--   * total_amount auto-derives from quantity × rate × (1 + gst).

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('fabric_purchase', 'FP', '{prefix}/{fy}/{seq:0000}', 1, '26-27')
ON CONFLICT (doc_type) DO NOTHING;

DO $$ BEGIN
  CREATE TYPE fabric_rate_unit AS ENUM ('m', 'pcs');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE fabric_delivery_destination AS ENUM ('in_house', 'sizing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.fabric_purchase (
  id                   bigserial PRIMARY KEY,
  code                 text NOT NULL UNIQUE,           -- FP/26-27/NNNN auto
  fabric_quality_id    bigint REFERENCES public.fabric_quality(id) ON DELETE SET NULL,
  supplier_party_id    bigint REFERENCES public.party(id)          ON DELETE SET NULL,
  received_date        date NOT NULL DEFAULT CURRENT_DATE,
  -- Always record metres. quantity_pieces is filled when the rate is
  -- per-piece OR when the supplier quoted both (some shirting buys
  -- track both lengths and the piece count).
  received_metres      numeric(12,2) NOT NULL CHECK (received_metres > 0),
  received_pieces      integer,
  rate_unit            fabric_rate_unit NOT NULL DEFAULT 'm',
  rate                 numeric(12,4) NOT NULL CHECK (rate >= 0),
  gst_pct              numeric(6,2)  NOT NULL DEFAULT 5,
  -- total_amount = quantity * rate * (1 + gst/100). Quantity is
  -- received_metres when rate_unit='m' and received_pieces when
  -- rate_unit='pcs'. Stored as a GENERATED column so it stays in sync
  -- with edits.
  total_amount         numeric(14,2) GENERATED ALWAYS AS (
    CASE rate_unit
      WHEN 'm'   THEN ROUND(received_metres * rate * (1 + gst_pct / 100), 2)
      WHEN 'pcs' THEN ROUND(COALESCE(received_pieces, 0) * rate * (1 + gst_pct / 100), 2)
    END
  ) STORED,
  invoice_no           text NOT NULL,
  delivery_destination fabric_delivery_destination NOT NULL DEFAULT 'in_house',
  notes                text,
  -- Live stock balance (decremented when fabric is consumed / sold).
  -- Starts at received_metres; the consuming flow (resale, jobwork
  -- shipping, etc.) is responsible for reducing it.
  current_metres       numeric(12,2) NOT NULL,
  status               public.record_status NOT NULL DEFAULT 'active',
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);

CREATE INDEX IF NOT EXISTS idx_fabric_purchase_quality  ON public.fabric_purchase(fabric_quality_id);
CREATE INDEX IF NOT EXISTS idx_fabric_purchase_supplier ON public.fabric_purchase(supplier_party_id);
CREATE INDEX IF NOT EXISTS idx_fabric_purchase_date     ON public.fabric_purchase(received_date);
CREATE INDEX IF NOT EXISTS idx_fabric_purchase_status   ON public.fabric_purchase(status);

-- Auto code via the existing autogen helper. fn_autogen_code keys off
-- TG_TABLE_NAME; we use a dedicated function so the doc_type ('fabric_purchase')
-- doesn't collide with the existing mapping table.
CREATE OR REPLACE FUNCTION public.fn_fabric_purchase_auto_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.code IS NOT NULL AND NEW.code <> '' THEN RETURN NEW; END IF;
  NEW.code := public.fn_next_doc_no('fabric_purchase');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_fabric_purchase_auto_code ON public.fabric_purchase;
CREATE TRIGGER trg_fabric_purchase_auto_code
  BEFORE INSERT ON public.fabric_purchase
  FOR EACH ROW EXECUTE FUNCTION public.fn_fabric_purchase_auto_code();

-- Default current_metres = received_metres on insert when the caller
-- doesn't set it explicitly.
CREATE OR REPLACE FUNCTION public.fn_fabric_purchase_init_stock()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.current_metres IS NULL THEN
    NEW.current_metres := NEW.received_metres;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_fabric_purchase_init_stock ON public.fabric_purchase;
CREATE TRIGGER trg_fabric_purchase_init_stock
  BEFORE INSERT ON public.fabric_purchase
  FOR EACH ROW EXECUTE FUNCTION public.fn_fabric_purchase_init_stock();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.fn_fabric_purchase_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$$;

DROP TRIGGER IF EXISTS trg_fabric_purchase_touch ON public.fabric_purchase;
CREATE TRIGGER trg_fabric_purchase_touch
  BEFORE UPDATE ON public.fabric_purchase
  FOR EACH ROW EXECUTE FUNCTION public.fn_fabric_purchase_touch_updated_at();

ALTER TABLE public.fabric_purchase ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_fabric_purchase_select ON public.fabric_purchase;
CREATE POLICY p_fabric_purchase_select ON public.fabric_purchase FOR SELECT USING (true);
DROP POLICY IF EXISTS p_fabric_purchase_modify ON public.fabric_purchase;
CREATE POLICY p_fabric_purchase_modify ON public.fabric_purchase FOR ALL USING (true) WITH CHECK (true);

COMMIT;
