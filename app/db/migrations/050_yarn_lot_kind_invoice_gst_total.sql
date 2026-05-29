-- 050_yarn_lot_kind_invoice_gst_total.sql
--
-- yarn_lot becomes the purchase log for both warp yarn (yarn_kind='yarn')
-- and selvedge yarn (yarn_kind='porvai'). Existing rows default to 'yarn'.
-- Adds invoice_no, gst_pct, and a stored generated total_amount used by
-- the new /yarn-stock and /porvai-yarn-stock pages.

BEGIN;

ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS yarn_kind   text          NOT NULL DEFAULT 'yarn' CHECK (yarn_kind IN ('yarn','porvai')),
  ADD COLUMN IF NOT EXISTS invoice_no  text,
  ADD COLUMN IF NOT EXISTS gst_pct     numeric(5,2)  NOT NULL DEFAULT 0 CHECK (gst_pct >= 0);

ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS total_amount numeric(14,2)
    GENERATED ALWAYS AS (
      ROUND(received_kg * cost_per_kg * (1 + gst_pct / 100.0), 2)
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_yarn_lot_kind          ON public.yarn_lot(yarn_kind);
CREATE INDEX IF NOT EXISTS idx_yarn_lot_received_date ON public.yarn_lot(received_date DESC);

COMMENT ON COLUMN public.yarn_lot.yarn_kind    IS 'Discriminator: yarn = warp/normal yarn; porvai = selvedge yarn.';
COMMENT ON COLUMN public.yarn_lot.invoice_no   IS 'Supplier invoice number for this purchase.';
COMMENT ON COLUMN public.yarn_lot.gst_pct      IS 'GST percentage applied (e.g. 5, 18).';
COMMENT ON COLUMN public.yarn_lot.total_amount IS 'Auto = received_kg * cost_per_kg * (1 + gst_pct/100).';

COMMIT;
