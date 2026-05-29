-- 057_yarn_lot_autogen_lot_code.sql
--
-- yarn_lot's identifier column is lot_code (not code), so the shared
-- fn_autogen_code() trigger doesn't fire on it. The Yarn Stock and
-- Porvai Yarn Stock forms omit lot_code on insert, expecting the DB to
-- fill it from the 'lot' doc_sequence (LOT-NNNN). This adds the
-- dedicated trigger so those inserts stop violating the NOT NULL
-- constraint.

BEGIN;

CREATE OR REPLACE FUNCTION public.tg_yarn_lot_autogen_lot_code()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lot_code IS NOT NULL AND NEW.lot_code <> '' THEN
    RETURN NEW;
  END IF;
  NEW.lot_code := public.fn_next_doc_no('lot');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_yarn_lot_autogen_lot_code ON public.yarn_lot;
CREATE TRIGGER trg_yarn_lot_autogen_lot_code
  BEFORE INSERT ON public.yarn_lot
  FOR EACH ROW EXECUTE FUNCTION public.tg_yarn_lot_autogen_lot_code();

COMMIT;
