-- 237_general_purchase_item_gst.sql
--
-- Per-item GST on General Purchase line items.
--
-- Each item row gets its own gst_pct; the row's tax = amount * gst%.
-- With mixed rates on one bill, the bill total can no longer be derived
-- from a single bill-level gst_pct, so general_purchase.total stops
-- being a generated column and becomes a plain column the form writes
-- (existing values are preserved by DROP EXPRESSION).
--
-- The bill-level gst_pct is kept as the blended rate (gst / taxable)
-- so the Purchase Register keeps showing a sensible % — its gst_amount
-- is computed as total - taxable, which stays exact.

BEGIN;

ALTER TABLE public.general_purchase_item
  ADD COLUMN IF NOT EXISTS gst_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (gst_pct >= 0);

-- Per-row tax, kept in sync: round(amount * gst%, 2).
ALTER TABLE public.general_purchase_item
  ADD COLUMN IF NOT EXISTS gst_amount numeric(14,2) GENERATED ALWAYS AS (
    ROUND(ROUND(qty * rate, 2) * gst_pct / 100, 2)
  ) STORED;

-- total: generated -> plain column (values preserved).
ALTER TABLE public.general_purchase
  ALTER COLUMN total DROP EXPRESSION;

COMMIT;
