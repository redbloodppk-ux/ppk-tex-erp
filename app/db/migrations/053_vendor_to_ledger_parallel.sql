-- 053_vendor_to_ledger_parallel.sql
--
-- Vendor master is being replaced by the Ledgers master. This migration:
--   1) copies every active vendor row into ledger
--   2) adds parallel ledger_id columns to every table currently FK'd to
--      vendor (11 columns across 9 tables)
--   3) backfills the parallel columns via a vendor_id <-> ledger_id map
--   4) installs a sync trigger on yarn_lot so writes that still send
--      vendor_id keep the new ledger_id in sync
--
-- The legacy vendor_id columns are NOT dropped here - existing UIs keep
-- working. New UIs read/write the *_ledger_id columns and the data
-- stays consistent in both places.

BEGIN;

INSERT INTO public.ledger_type (name) VALUES ('FOLDING(VENDOR)') ON CONFLICT (name) DO NOTHING;

WITH type_map(vendor_type, ledger_type_name) AS (
  VALUES
    ('sizing',  'SIZING(VENDOR)'),
    ('weaving', 'WEAVING(VENDOR)'),
    ('folding', 'FOLDING(VENDOR)'),
    ('broker',  'AGENT')
),
prep AS (
  SELECT
    v.id AS vendor_id, lt.id AS type_id, lg.id AS group_id,
    v.name, v.address, v.phone, v.email, v.gstin
  FROM public.vendor v
  JOIN type_map      m  ON m.vendor_type = v.vendor_type
  JOIN public.ledger_type  lt ON lt.name = m.ledger_type_name
  JOIN public.ledger_group lg ON lg.name = 'SUNDRY CREDITORS'
  WHERE v.status <> 'archived'
    AND NOT EXISTS (SELECT 1 FROM public.ledger l WHERE l.name = v.name)
)
INSERT INTO public.ledger (name, type_id, group_id, address1, phone, email, gstin)
SELECT name, type_id, group_id, address, phone, email, gstin FROM prep;

CREATE OR REPLACE VIEW public.v_vendor_ledger_map AS
SELECT v.id AS vendor_id, l.id AS ledger_id
FROM public.vendor v
JOIN public.ledger l ON l.name = v.name;

ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS broker_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sizing_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

ALTER TABLE public.pavu
  ADD COLUMN IF NOT EXISTS outsource_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

ALTER TABLE public.sizing_job
  ADD COLUMN IF NOT EXISTS sizing_ledger_id            bigint REFERENCES public.ledger(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS default_outsource_ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

ALTER TABLE public.outsource_order    ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.delivery_challan   ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.invoice            ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.payment            ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.resale_lot         ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_performance ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

UPDATE public.yarn_lot           t SET broker_ledger_id            = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.broker_id            AND t.broker_id IS NOT NULL;
UPDATE public.yarn_lot           t SET sizing_ledger_id            = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.sizing_vendor_id     AND t.sizing_vendor_id IS NOT NULL;
UPDATE public.pavu               t SET outsource_ledger_id         = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.outsource_vendor_id  AND t.outsource_vendor_id IS NOT NULL;
UPDATE public.sizing_job         t SET sizing_ledger_id            = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.sizing_vendor_id     AND t.sizing_vendor_id IS NOT NULL;
UPDATE public.sizing_job         t SET default_outsource_ledger_id = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.default_outsource_vendor_id AND t.default_outsource_vendor_id IS NOT NULL;
UPDATE public.outsource_order    t SET ledger_id                   = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.vendor_id             AND t.vendor_id IS NOT NULL;
UPDATE public.delivery_challan   t SET ledger_id                   = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.vendor_id             AND t.vendor_id IS NOT NULL;
UPDATE public.invoice            t SET ledger_id                   = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.vendor_id             AND t.vendor_id IS NOT NULL;
UPDATE public.payment            t SET ledger_id                   = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.vendor_id             AND t.vendor_id IS NOT NULL;
UPDATE public.resale_lot         t SET ledger_id                   = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.vendor_id             AND t.vendor_id IS NOT NULL;
UPDATE public.vendor_performance t SET ledger_id                   = m.ledger_id FROM public.v_vendor_ledger_map m WHERE m.vendor_id = t.vendor_id             AND t.vendor_id IS NOT NULL;

-- Sync trigger on yarn_lot: legacy code that writes vendor_id keeps
-- ledger_id mirrors in sync automatically.
CREATE OR REPLACE FUNCTION public.tg_yarn_lot_sync_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.broker_id IS NOT NULL AND NEW.broker_ledger_id IS NULL THEN
    SELECT ledger_id INTO NEW.broker_ledger_id FROM public.v_vendor_ledger_map WHERE vendor_id = NEW.broker_id;
  END IF;
  IF NEW.sizing_vendor_id IS NOT NULL AND NEW.sizing_ledger_id IS NULL THEN
    SELECT ledger_id INTO NEW.sizing_ledger_id FROM public.v_vendor_ledger_map WHERE vendor_id = NEW.sizing_vendor_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_yarn_lot_sync_ledger ON public.yarn_lot;
CREATE TRIGGER trg_yarn_lot_sync_ledger BEFORE INSERT OR UPDATE ON public.yarn_lot
  FOR EACH ROW EXECUTE FUNCTION public.tg_yarn_lot_sync_ledger();

COMMIT;
