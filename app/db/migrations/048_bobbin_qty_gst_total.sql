-- 048_bobbin_qty_gst_total.sql
--
-- Bobbin purchase log gains a quantity, GST %, and a stored generated
-- total = qty * price * (1 + gst/100). The UI uses these for the new
-- "Total" column and the live preview while you type.

BEGIN;

ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  ADD COLUMN IF NOT EXISTS gst_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (gst_pct >= 0);

ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS total_amount numeric(14,2)
    GENERATED ALWAYS AS (
      ROUND(quantity * bobbin_price * (1 + gst_pct / 100.0), 2)
    ) STORED;

COMMENT ON COLUMN public.bobbin.quantity     IS 'Number of bobbin pieces in this purchase batch.';
COMMENT ON COLUMN public.bobbin.gst_pct      IS 'GST percentage applied to the line (e.g. 18 for 18%).';
COMMENT ON COLUMN public.bobbin.total_amount IS 'Auto-computed total = qty * price * (1 + gst/100).';

COMMIT;
