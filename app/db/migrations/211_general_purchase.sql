-- 211_general_purchase.sql
--
-- General Purchase GST bills — a catch-all supplier purchase that isn't
-- yarn, bobbin, sizing, fabric, or outsource weaving (e.g. packing
-- material, spares, consumables, services). The operator records the
-- supplier's invoice with a single taxable amount + GST %, and it shows
-- up in the Purchase Register alongside the other purchase sources.
--
-- Register-only: there is no payment tracking here, so amount_paid stays
-- 0. The bill simply needs to appear in the Purchase Register for the
-- correct GST period (keyed off the supplier's invoice date / number).
--
-- This migration:
--   1. Creates public.general_purchase
--   2. Recreates v_purchase_register adding a 'general' source CTE
--      (the rest of the view is identical to migration 209).

BEGIN;

CREATE TABLE IF NOT EXISTS public.general_purchase (
  id                bigserial PRIMARY KEY,
  bill_no           text NOT NULL,                          -- supplier invoice no (manual)
  bill_date         date NOT NULL DEFAULT CURRENT_DATE,     -- supplier invoice date
  supplier_party_id bigint NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  description       text,
  taxable           numeric(14,2) NOT NULL CHECK (taxable >= 0),
  gst_pct           numeric(6,2)  NOT NULL DEFAULT 0,
  -- total = taxable * (1 + gst/100), kept in sync as a generated column.
  total             numeric(14,2) GENERATED ALWAYS AS (
    ROUND(taxable * (1 + gst_pct / 100), 2)
  ) STORED,
  -- Register-only: no payment tracking. Column kept for view parity.
  amount_paid       numeric(14,2) NOT NULL DEFAULT 0,
  status            public.record_status NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS idx_general_purchase_supplier ON public.general_purchase(supplier_party_id);
CREATE INDEX IF NOT EXISTS idx_general_purchase_date     ON public.general_purchase(bill_date);
CREATE INDEX IF NOT EXISTS idx_general_purchase_status   ON public.general_purchase(status);

CREATE OR REPLACE FUNCTION public.fn_general_purchase_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$$;

DROP TRIGGER IF EXISTS trg_general_purchase_touch ON public.general_purchase;
CREATE TRIGGER trg_general_purchase_touch
  BEFORE UPDATE ON public.general_purchase
  FOR EACH ROW EXECUTE FUNCTION public.fn_general_purchase_touch_updated_at();

ALTER TABLE public.general_purchase ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_general_purchase_select ON public.general_purchase;
CREATE POLICY p_general_purchase_select ON public.general_purchase FOR SELECT USING (true);
DROP POLICY IF EXISTS p_general_purchase_modify ON public.general_purchase;
CREATE POLICY p_general_purchase_modify ON public.general_purchase FOR ALL USING (true) WITH CHECK (true);

-- Recreate the Purchase Register view with the new 'general' source.
CREATE OR REPLACE VIEW public.v_purchase_register AS
 WITH company AS (
         SELECT upper(COALESCE(company_profile.state, 'TAMIL NADU'::text)) AS state
           FROM company_profile
         LIMIT 1
        ), yarn AS (
         SELECT 'yarn'::text AS source,
            yl.id AS source_id,
            yl.received_date AS bill_date,
            yl.invoice_no AS bill_no,
            yl.supplier_party_id AS party_id,
            yl.received_kg::numeric(14,2) AS quantity,
            'kg'::text AS qty_uom,
            COALESCE(yl.gst_pct, 0::numeric)::numeric(6,2) AS gst_pct,
            round(yl.total_amount / (1::numeric + COALESCE(yl.gst_pct, 0::numeric) / 100.0), 2)::numeric(14,2) AS taxable,
            yl.total_amount AS total,
            COALESCE(yl.amount_paid, 0::numeric)::numeric(14,2) AS amount_paid,
            'active'::text AS status,
            NULL::numeric(14,2) AS cgst_inv,
            NULL::numeric(14,2) AS sgst_inv,
            NULL::numeric(14,2) AS igst_inv,
            NULL::boolean AS is_interstate_inv
           FROM yarn_lot yl
          WHERE yl.total_amount IS NOT NULL AND yl.total_amount > 0::numeric
        ), bobbin AS (
         SELECT 'bobbin'::text AS source,
            bp.id AS source_id,
            bp.purchase_date AS bill_date,
            bp.invoice_no AS bill_no,
            b.supplier_party_id AS party_id,
            COALESCE(bp.pieces_purchased, 0::numeric)::numeric(14,2) AS quantity,
            'pcs'::text AS qty_uom,
            0::numeric(6,2) AS gst_pct,
            bp.total_amount AS taxable,
            bp.total_amount AS total,
            COALESCE(bp.amount_paid, 0::numeric)::numeric(14,2) AS amount_paid,
            'active'::text AS status,
            NULL::numeric(14,2) AS cgst_inv,
            NULL::numeric(14,2) AS sgst_inv,
            NULL::numeric(14,2) AS igst_inv,
            NULL::boolean AS is_interstate_inv
           FROM bobbin_purchase bp
             LEFT JOIN public.bobbin b ON b.id = bp.bobbin_id
          WHERE bp.total_amount IS NOT NULL AND bp.total_amount > 0::numeric
        ), sizing AS (
         SELECT 'sizing'::text AS source,
            sj.id AS source_id,
            COALESCE(sj.bill_date, sj.date_received, sj.date_sent) AS bill_date,
            COALESCE(sj.bill_no, sj.job_code) AS bill_no,
            sj.party_id,
            COALESCE(sj.yarn_sent_kg, 0::numeric)::numeric(14,2) AS quantity,
            'kg'::text AS qty_uom,
            COALESCE(sj.gst_pct, 0::numeric)::numeric(6,2) AS gst_pct,
            COALESCE(sj.charges_amount, 0::numeric)::numeric(14,2) AS taxable,
            COALESCE(sj.total_amount, 0::numeric)::numeric(14,2) AS total,
            COALESCE(sj.amount_paid, 0::numeric)::numeric(14,2) AS amount_paid,
            sj.status::text AS status,
            NULL::numeric(14,2) AS cgst_inv,
            NULL::numeric(14,2) AS sgst_inv,
            NULL::numeric(14,2) AS igst_inv,
            NULL::boolean AS is_interstate_inv
           FROM sizing_job sj
          WHERE COALESCE(sj.total_amount, 0::numeric) > 0::numeric AND (sj.status::text <> ALL (ARRAY['draft'::text, 'cancelled'::text]))
        ), fabric AS (
         SELECT 'fabric'::text AS source,
            fp.id AS source_id,
            fp.received_date AS bill_date,
            fp.invoice_no AS bill_no,
            fp.supplier_party_id AS party_id,
            fp.received_metres::numeric(14,2) AS quantity,
            'm'::text AS qty_uom,
            COALESCE(fp.gst_pct, 0::numeric)::numeric(6,2) AS gst_pct,
            round(fp.total_amount / (1::numeric + COALESCE(fp.gst_pct, 0::numeric) / 100.0), 2)::numeric(14,2) AS taxable,
            fp.total_amount AS total,
            COALESCE(fp.amount_paid, 0::numeric)::numeric(14,2) AS amount_paid,
            fp.status::text AS status,
            NULL::numeric(14,2) AS cgst_inv,
            NULL::numeric(14,2) AS sgst_inv,
            NULL::numeric(14,2) AS igst_inv,
            NULL::boolean AS is_interstate_inv
           FROM fabric_purchase fp
          WHERE fp.total_amount IS NOT NULL AND fp.total_amount > 0::numeric AND (fp.status::text <> ALL (ARRAY['archived'::text, 'inactive'::text]))
        ), general AS (
         SELECT 'general'::text AS source,
            gp.id AS source_id,
            gp.bill_date,
            gp.bill_no,
            gp.supplier_party_id AS party_id,
            NULL::numeric(14,2) AS quantity,
            ''::text AS qty_uom,
            COALESCE(gp.gst_pct, 0::numeric)::numeric(6,2) AS gst_pct,
            COALESCE(gp.taxable, 0::numeric)::numeric(14,2) AS taxable,
            COALESCE(gp.total, 0::numeric)::numeric(14,2) AS total,
            COALESCE(gp.amount_paid, 0::numeric)::numeric(14,2) AS amount_paid,
            gp.status::text AS status,
            NULL::numeric(14,2) AS cgst_inv,
            NULL::numeric(14,2) AS sgst_inv,
            NULL::numeric(14,2) AS igst_inv,
            NULL::boolean AS is_interstate_inv
           FROM general_purchase gp
          WHERE COALESCE(gp.total, 0::numeric) > 0::numeric AND (gp.status::text <> ALL (ARRAY['draft'::text, 'cancelled'::text]))
        ), weaving AS (
         SELECT 'outsource_weaving'::text AS source,
            inv.id AS source_id,
            inv.invoice_date AS bill_date,
            inv.invoice_no AS bill_no,
            inv.jobwork_party_id AS party_id,
            COALESCE(( SELECT sum(il.quantity) AS sum
                   FROM invoice_line il
                  WHERE il.invoice_id = inv.id), 0::numeric)::numeric(14,2) AS quantity,
            'm'::text AS qty_uom,
            NULL::numeric(6,2) AS gst_pct,
            inv.taxable_value::numeric(14,2) AS taxable,
            inv.total,
            COALESCE(inv.amount_paid, 0::numeric)::numeric(14,2) AS amount_paid,
            inv.status::text AS status,
            inv.cgst_amount::numeric(14,2) AS cgst_inv,
            inv.sgst_amount::numeric(14,2) AS sgst_inv,
            inv.igst_amount::numeric(14,2) AS igst_inv,
            inv.is_interstate AS is_interstate_inv
           FROM invoice inv
          WHERE inv.doc_type = 'weaving_bill'::invoice_doc_type AND (inv.status::text <> ALL (ARRAY['draft'::text, 'cancelled'::text]))
        ), all_sources AS (
         SELECT yarn.source, yarn.source_id, yarn.bill_date, yarn.bill_no, yarn.party_id, yarn.quantity, yarn.qty_uom, yarn.gst_pct, yarn.taxable, yarn.total, yarn.amount_paid, yarn.status, yarn.cgst_inv, yarn.sgst_inv, yarn.igst_inv, yarn.is_interstate_inv
           FROM yarn
        UNION ALL
         SELECT bobbin.source, bobbin.source_id, bobbin.bill_date, bobbin.bill_no, bobbin.party_id, bobbin.quantity, bobbin.qty_uom, bobbin.gst_pct, bobbin.taxable, bobbin.total, bobbin.amount_paid, bobbin.status, bobbin.cgst_inv, bobbin.sgst_inv, bobbin.igst_inv, bobbin.is_interstate_inv
           FROM bobbin
        UNION ALL
         SELECT sizing.source, sizing.source_id, sizing.bill_date, sizing.bill_no, sizing.party_id, sizing.quantity, sizing.qty_uom, sizing.gst_pct, sizing.taxable, sizing.total, sizing.amount_paid, sizing.status, sizing.cgst_inv, sizing.sgst_inv, sizing.igst_inv, sizing.is_interstate_inv
           FROM sizing
        UNION ALL
         SELECT fabric.source, fabric.source_id, fabric.bill_date, fabric.bill_no, fabric.party_id, fabric.quantity, fabric.qty_uom, fabric.gst_pct, fabric.taxable, fabric.total, fabric.amount_paid, fabric.status, fabric.cgst_inv, fabric.sgst_inv, fabric.igst_inv, fabric.is_interstate_inv
           FROM fabric
        UNION ALL
         SELECT general.source, general.source_id, general.bill_date, general.bill_no, general.party_id, general.quantity, general.qty_uom, general.gst_pct, general.taxable, general.total, general.amount_paid, general.status, general.cgst_inv, general.sgst_inv, general.igst_inv, general.is_interstate_inv
           FROM general
        UNION ALL
         SELECT weaving.source, weaving.source_id, weaving.bill_date, weaving.bill_no, weaving.party_id, weaving.quantity, weaving.qty_uom, weaving.gst_pct, weaving.taxable, weaving.total, weaving.amount_paid, weaving.status, weaving.cgst_inv, weaving.sgst_inv, weaving.igst_inv, weaving.is_interstate_inv
           FROM weaving
        )
 SELECT s.source,
    s.source_id,
    s.bill_date,
    s.bill_no,
    s.party_id,
    COALESCE(p.code, ''::text) AS party_code,
    COALESCE(p.name, '—'::text) AS party_name,
    p.gstin AS party_gstin,
    p.state AS party_state,
    s.quantity,
    s.qty_uom,
    COALESCE(s.gst_pct, 0::numeric) AS gst_pct,
    s.taxable,
    GREATEST(s.total - s.taxable, 0::numeric)::numeric(14,2) AS gst_amount,
    s.total,
    s.amount_paid,
    (s.total - s.amount_paid)::numeric(14,2) AS balance,
    s.status,
        CASE
            WHEN s.is_interstate_inv IS NOT NULL THEN s.is_interstate_inv
            WHEN p.state IS NULL THEN false
            ELSE upper(p.state) <> c.state
        END AS is_interstate,
        CASE
            WHEN s.cgst_inv IS NOT NULL THEN s.cgst_inv
            WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN 0::numeric
            ELSE round(GREATEST(s.total - s.taxable, 0::numeric) / 2.0, 2)
        END::numeric(14,2) AS cgst_amount,
        CASE
            WHEN s.sgst_inv IS NOT NULL THEN s.sgst_inv
            WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN 0::numeric
            ELSE round(GREATEST(s.total - s.taxable, 0::numeric) / 2.0, 2)
        END::numeric(14,2) AS sgst_amount,
        CASE
            WHEN s.igst_inv IS NOT NULL THEN s.igst_inv
            WHEN p.state IS NOT NULL AND upper(p.state) <> c.state THEN GREATEST(s.total - s.taxable, 0::numeric)
            ELSE 0::numeric
        END::numeric(14,2) AS igst_amount,
        CASE
            WHEN COALESCE(s.gst_pct, 0::numeric) > 0::numeric OR s.cgst_inv IS NOT NULL OR s.sgst_inv IS NOT NULL OR s.igst_inv IS NOT NULL OR s.total > s.taxable THEN 'with_gst'::text
            ELSE 'without_gst'::text
        END AS gst_flag
   FROM all_sources s
     CROSS JOIN company c
     LEFT JOIN party p ON p.id = s.party_id
  WHERE s.bill_date IS NOT NULL;

COMMIT;
