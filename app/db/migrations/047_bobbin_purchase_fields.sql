-- 047_bobbin_purchase_fields.sql
--
-- Bobbin master is being repurposed as a purchase log. Each row is now
-- one bobbin purchase batch with a date + invoice. Loading-per-metre
-- and reorder-pieces are no longer surfaced in the UI but the columns
-- stay so older reports keep compiling.

BEGIN;

ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS purchase_date date,
  ADD COLUMN IF NOT EXISTS invoice_no    text;

CREATE INDEX IF NOT EXISTS idx_bobbin_purchase_date ON public.bobbin(purchase_date);

COMMENT ON COLUMN public.bobbin.purchase_date IS 'Date this bobbin batch was purchased.';
COMMENT ON COLUMN public.bobbin.invoice_no    IS 'Supplier invoice number for this purchase.';

COMMIT;
