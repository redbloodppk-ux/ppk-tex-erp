-- 236_general_purchase_items.sql
--
-- Optional line items for General Purchase bills. The operator can add
-- item rows (name, qty, unit, rate) and the amount per row is qty * rate.
-- When items exist, the bill's taxable amount is the sum of item amounts
-- (the form keeps them in sync). Bills without items keep working exactly
-- as before — items are purely additive.
--
-- GST stays at bill level (single gst_pct on general_purchase), so the
-- Purchase Register view is unchanged.

BEGIN;

CREATE TABLE IF NOT EXISTS public.general_purchase_item (
  id                  bigserial PRIMARY KEY,
  general_purchase_id bigint NOT NULL REFERENCES public.general_purchase(id) ON DELETE CASCADE,
  item_name           text NOT NULL,
  qty                 numeric(14,3) NOT NULL DEFAULT 1 CHECK (qty >= 0),
  unit                text,                                   -- e.g. pcs, kg, box, nos
  rate                numeric(14,2) NOT NULL DEFAULT 0 CHECK (rate >= 0),
  -- amount = qty * rate, kept in sync as a generated column.
  amount              numeric(14,2) GENERATED ALWAYS AS (
    ROUND(qty * rate, 2)
  ) STORED,
  position            int NOT NULL DEFAULT 0,                 -- display order on the bill
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_general_purchase_item_bill
  ON public.general_purchase_item(general_purchase_id);

ALTER TABLE public.general_purchase_item ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_general_purchase_item_select ON public.general_purchase_item;
CREATE POLICY p_general_purchase_item_select ON public.general_purchase_item FOR SELECT USING (true);
DROP POLICY IF EXISTS p_general_purchase_item_modify ON public.general_purchase_item;
CREATE POLICY p_general_purchase_item_modify ON public.general_purchase_item FOR ALL USING (true) WITH CHECK (true);

COMMIT;
