-- 238_general_purchase_total_fallback.sql
--
-- Safety net after total became a plain column (migration 237): any
-- insert/update that leaves total NULL falls back to the old formula
-- ROUND(taxable * (1 + gst_pct/100), 2). Protects bills saved by a
-- stale (pre-per-item-GST) form build or any future code path that
-- forgets to send total.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_general_purchase_total_default()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total IS NULL THEN
    NEW.total := ROUND(NEW.taxable * (1 + COALESCE(NEW.gst_pct, 0) / 100), 2);
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_general_purchase_total_default ON public.general_purchase;
CREATE TRIGGER trg_general_purchase_total_default
  BEFORE INSERT OR UPDATE ON public.general_purchase
  FOR EACH ROW EXECUTE FUNCTION public.fn_general_purchase_total_default();

COMMIT;
