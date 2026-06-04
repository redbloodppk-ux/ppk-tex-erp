-- 095_opening_stock.sql
-- Opening stock table. One row per (bucket, mode, key) at the moment
-- the user wants to set their starting balance. Used by the warehouse
-- pivot view as an "in" inflow event on open_date.

BEGIN;

CREATE TABLE IF NOT EXISTS public.opening_stock (
  id                  bigserial PRIMARY KEY,
  bucket              text NOT NULL,   -- 'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin'
  mode                text NOT NULL DEFAULT 'inhouse',
  fabric_quality_id   bigint REFERENCES public.fabric_quality(id) ON DELETE SET NULL,
  yarn_count_id       bigint REFERENCES public.yarn_count(id)     ON DELETE SET NULL,
  bobbin_id           bigint REFERENCES public.bobbin(id)         ON DELETE SET NULL,
  ends_per_bobbin     integer,
  quantity            numeric NOT NULL DEFAULT 0,
  unit                text NOT NULL,
  open_date           date NOT NULL DEFAULT CURRENT_DATE,
  reference_no        text,
  notes               text,
  status              text NOT NULL DEFAULT 'active',
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid
);

CREATE INDEX IF NOT EXISTS idx_opening_stock_bucket  ON public.opening_stock(bucket, mode);
CREATE INDEX IF NOT EXISTS idx_opening_stock_quality ON public.opening_stock(fabric_quality_id);
CREATE INDEX IF NOT EXISTS idx_opening_stock_count   ON public.opening_stock(yarn_count_id);
CREATE INDEX IF NOT EXISTS idx_opening_stock_bobbin  ON public.opening_stock(bobbin_id);
CREATE INDEX IF NOT EXISTS idx_opening_stock_date    ON public.opening_stock(open_date);

ALTER TABLE public.opening_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_opening_stock_select ON public.opening_stock;
CREATE POLICY p_opening_stock_select ON public.opening_stock FOR SELECT USING (true);
DROP POLICY IF EXISTS p_opening_stock_modify ON public.opening_stock;
CREATE POLICY p_opening_stock_modify ON public.opening_stock FOR ALL USING (true) WITH CHECK (true);

COMMIT;
