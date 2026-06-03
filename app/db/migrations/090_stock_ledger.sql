-- 090_stock_ledger.sql
--
-- Two changes to support a ledger-style stock view in the Warehouse:
--
--   1. Add `original_metres` / `original_kg` / `original_quantity` columns
--      to the jobwork inflow tables so we can show the opening balance
--      even after the live balance has been reduced by fabric receipts.
--      For existing rows the original is backfilled from the live value
--      (assumes those rows haven't been reduced yet; if some have, the
--      ledger will show "today's snapshot" as the opening — close enough
--      for the first iteration).
--
--   2. Create a `stock_ledger` table that records every outflow event
--      against a jobwork stock bucket. The Warehouse jobwork ledger view
--      reads this table to render the running-balance timeline. Outflows
--      come from fabric_receipt for now; future flows (returns, rework)
--      can write into the same table with a different `source_kind`.

BEGIN;

-- ── 1. Preserve original inflow amounts ────────────────────────────────────

ALTER TABLE public.jobwork_warp_beam
  ADD COLUMN IF NOT EXISTS original_metres numeric(12,2);
UPDATE public.jobwork_warp_beam
   SET original_metres = total_metres
 WHERE original_metres IS NULL;

ALTER TABLE public.jobwork_weft_bag
  ADD COLUMN IF NOT EXISTS original_kg numeric(12,3);
UPDATE public.jobwork_weft_bag
   SET original_kg = total_kg
 WHERE original_kg IS NULL;

ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS original_quantity numeric;
UPDATE public.bobbin
   SET original_quantity = quantity
 WHERE original_quantity IS NULL;

-- A small trigger to default the originals on INSERT if the caller
-- doesn't set them explicitly. This means new rows automatically gain
-- the right opening-balance entry for the ledger.
CREATE OR REPLACE FUNCTION public.fn_set_original_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'jobwork_warp_beam' AND NEW.original_metres IS NULL THEN
    NEW.original_metres := NEW.total_metres;
  ELSIF TG_TABLE_NAME = 'jobwork_weft_bag' AND NEW.original_kg IS NULL THEN
    NEW.original_kg := NEW.total_kg;
  ELSIF TG_TABLE_NAME = 'bobbin' AND NEW.original_quantity IS NULL THEN
    NEW.original_quantity := NEW.quantity;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_jwb_set_original ON public.jobwork_warp_beam;
CREATE TRIGGER tr_jwb_set_original
  BEFORE INSERT ON public.jobwork_warp_beam
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_original_on_insert();

DROP TRIGGER IF EXISTS tr_jwbag_set_original ON public.jobwork_weft_bag;
CREATE TRIGGER tr_jwbag_set_original
  BEFORE INSERT ON public.jobwork_weft_bag
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_original_on_insert();

DROP TRIGGER IF EXISTS tr_bobbin_set_original ON public.bobbin;
CREATE TRIGGER tr_bobbin_set_original
  BEFORE INSERT ON public.bobbin
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_original_on_insert();

-- ── 2. Stock ledger (outflows) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.stock_ledger (
  id                bigserial PRIMARY KEY,
  bucket            text NOT NULL,        -- 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin' | 'fabric'
  direction         text NOT NULL DEFAULT 'out',  -- 'in' | 'out' | 'adjust'
  jobwork_party_id  bigint REFERENCES public.jobwork_party(id) ON DELETE SET NULL,
  fabric_quality_id bigint REFERENCES public.fabric_quality(id) ON DELETE SET NULL,
  yarn_count_id     bigint REFERENCES public.yarn_count(id) ON DELETE SET NULL,
  bobbin_id         bigint REFERENCES public.bobbin(id) ON DELETE SET NULL,
  quantity          numeric NOT NULL DEFAULT 0,   -- positive number; direction tells you sign
  unit              text NOT NULL,                -- 'm' | 'kg' | 'pcs'
  event_date        date NOT NULL DEFAULT CURRENT_DATE,
  source_kind       text NOT NULL,                -- 'fabric_receipt' for now
  source_id         bigint,                       -- fabric_receipt.id for receipt outflows
  reference_no      text,                         -- e.g. receipt code "FR/26-27/0001"
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_party   ON public.stock_ledger(jobwork_party_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_quality ON public.stock_ledger(fabric_quality_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_count   ON public.stock_ledger(yarn_count_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_bobbin  ON public.stock_ledger(bobbin_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_date    ON public.stock_ledger(event_date);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_source  ON public.stock_ledger(source_kind, source_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_bucket  ON public.stock_ledger(bucket);

ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_stock_ledger_select ON public.stock_ledger;
CREATE POLICY p_stock_ledger_select ON public.stock_ledger FOR SELECT USING (true);
DROP POLICY IF EXISTS p_stock_ledger_modify ON public.stock_ledger;
CREATE POLICY p_stock_ledger_modify ON public.stock_ledger FOR ALL USING (true) WITH CHECK (true);

COMMIT;
