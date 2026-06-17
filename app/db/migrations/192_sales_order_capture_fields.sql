-- 192_sales_order_capture_fields.sql
--
-- Adds the capture-time fields needed by the new /app/orders/new form.
--
-- sales_order
--   payment_date — optional date the operator expects the customer to
--   settle the invoice. Filled in here so the SO carries the expectation
--   forward through DC -> invoice -> payment without an extra master.
--
-- sales_order_line
--   fabric_quality_id — direct link to the master so an SO can be
--     captured straight from the price list, without first creating a
--     costing snapshot. The legacy costing_id route still works (it's
--     relaxed to nullable below so either ref satisfies a row).
--   uom — 'm' (metres) or 'pcs' (towel pieces). Lets the operator
--     quote bath towels by piece while still capturing equivalent
--     metres in quantity_m for delivery tracking.
--   pieces — populated when uom='pcs' or when the fabric_quality has a
--     meter_per_pc and the operator wants both numbers visible. Lines
--     where uom='m' and the quality is bare yardage leave this null.

ALTER TABLE public.sales_order
  ADD COLUMN IF NOT EXISTS payment_date date;

ALTER TABLE public.sales_order_line
  ADD COLUMN IF NOT EXISTS fabric_quality_id bigint REFERENCES public.fabric_quality(id),
  ADD COLUMN IF NOT EXISTS uom text NOT NULL DEFAULT 'm',
  ADD COLUMN IF NOT EXISTS pieces numeric(12,2);

-- costing_id was historically NOT NULL because every SO line had to
-- point at a frozen costing snapshot. With fabric_quality_id as a
-- direct alternative, we relax the constraint so the new capture flow
-- can record a line by quality alone.
ALTER TABLE public.sales_order_line
  ALTER COLUMN costing_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_order_line_fabric_quality
  ON public.sales_order_line (fabric_quality_id);
