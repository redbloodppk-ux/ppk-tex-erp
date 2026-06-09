-- 140_bobbin_master_consolidation.sql
--
-- Reshape the bobbin model so the master is 1:1 with bobbin_ends_master
-- and every purchase becomes a separate event log row.
--
-- Before:  one bobbin row per purchase batch (BB-0001 / BB-0002 / ...
--          all sharing the same ends_per_bobbin); price + invoice +
--          purchase_date live on the bobbin row itself.
-- After:   one bobbin row per ends-spec, code = "BB-<ends>"; every
--          historical purchase becomes a row in the new bobbin_purchase
--          log; current stock and FK references collapse onto the
--          surviving canonical row.
--
-- Per-ends canonical row selection: prefer the seed master row
-- (purchase_date IS NULL) when present, else MIN(id) among purchase
-- rows. All non-canonical rows have their inbound FKs re-pointed and
-- are then deleted.
--
-- All work is one transaction so a failure leaves the data untouched.

BEGIN;

-- 1) Backfill bobbin_ends_master with the actual ends values used in
--    bobbin so every bobbin row can link to a master row in step 8.
INSERT INTO public.bobbin_ends_master (ends_count, label, active)
SELECT DISTINCT b.ends_per_bobbin,
                b.ends_per_bobbin::text || ' ends/bobbin',
                true
FROM public.bobbin b
WHERE NOT EXISTS (
  SELECT 1 FROM public.bobbin_ends_master m WHERE m.ends_count = b.ends_per_bobbin
)
ON CONFLICT (ends_count) DO NOTHING;

-- 2) Create bobbin_purchase log.
CREATE TABLE IF NOT EXISTS public.bobbin_purchase (
  id               bigserial PRIMARY KEY,
  bobbin_id        bigint NOT NULL REFERENCES public.bobbin(id) ON DELETE CASCADE,
  purchase_date    date,
  invoice_no       text,
  vendor_id        bigint,  -- matches existing bobbin.vendor_id (no FK; supplier party lives elsewhere)
  pieces_purchased numeric(10,2),
  bobbin_metre     numeric(10,2),
  bobbin_price     numeric(12,2),
  total_amount     numeric(14,2) GENERATED ALWAYS AS
                     (COALESCE(pieces_purchased, 0) * COALESCE(bobbin_price, 0)) STORED,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES public.app_user(id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES public.app_user(id)
);

CREATE INDEX IF NOT EXISTS idx_bobbin_purchase_bobbin ON public.bobbin_purchase(bobbin_id);
CREATE INDEX IF NOT EXISTS idx_bobbin_purchase_date   ON public.bobbin_purchase(purchase_date);

ALTER TABLE public.bobbin_purchase ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bobbin_purchase_read  ON public.bobbin_purchase;
DROP POLICY IF EXISTS bobbin_purchase_write ON public.bobbin_purchase;
CREATE POLICY bobbin_purchase_read
  ON public.bobbin_purchase FOR SELECT TO authenticated USING (true);
CREATE POLICY bobbin_purchase_write
  ON public.bobbin_purchase FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_user u
                  WHERE u.id = auth.uid() AND u.role IN ('owner','mill_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.app_user u
                       WHERE u.id = auth.uid() AND u.role IN ('owner','mill_manager')));

CREATE OR REPLACE FUNCTION public.tg_bobbin_purchase_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_bobbin_purchase_touch ON public.bobbin_purchase;
CREATE TRIGGER trg_bobbin_purchase_touch
  BEFORE UPDATE ON public.bobbin_purchase
  FOR EACH ROW EXECUTE FUNCTION public.tg_bobbin_purchase_touch();

-- 3) Materialise the canonical bobbin id per ends_per_bobbin into a
--    temp table so the rest of the migration can join against it cheaply.
CREATE TEMP TABLE canonical_bobbin ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    ends_per_bobbin,
    ROW_NUMBER() OVER (
      PARTITION BY ends_per_bobbin
      ORDER BY
        CASE WHEN purchase_date IS NULL THEN 0 ELSE 1 END,  -- prefer master rows
        id
    ) AS rn
  FROM public.bobbin
)
SELECT id, ends_per_bobbin
FROM ranked
WHERE rn = 1;

-- 4) Migrate every bobbin row that has a purchase_date into
--    bobbin_purchase, linking to the canonical bobbin for its ends.
INSERT INTO public.bobbin_purchase (
  bobbin_id, purchase_date, invoice_no, vendor_id,
  pieces_purchased, bobbin_metre, bobbin_price, notes
)
SELECT
  c.id,
  b.purchase_date,
  b.invoice_no,
  b.vendor_id,
  NULL::numeric,            -- pieces_purchased not previously tracked
  b.bobbin_metre,
  b.bobbin_price,
  'Migrated from bobbin row id=' || b.id::text || ' code=' || b.code
FROM public.bobbin b
JOIN canonical_bobbin c USING (ends_per_bobbin)
WHERE b.purchase_date IS NOT NULL;

-- 5) Re-point every FK that points to a non-canonical bobbin so the
--    canonical row inherits the references before we drop the siblings.
UPDATE public.costing_master cm
SET    bobbin_1_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  cm.bobbin_1_id = b.id AND b.id <> c.id;

UPDATE public.costing_master cm
SET    bobbin_2_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  cm.bobbin_2_id = b.id AND b.id <> c.id;

UPDATE public.production_batch pb
SET    bobbin_1_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  pb.bobbin_1_id = b.id AND b.id <> c.id;

UPDATE public.production_batch pb
SET    bobbin_2_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  pb.bobbin_2_id = b.id AND b.id <> c.id;

UPDATE public.outsource_order oo
SET    bobbin_1_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  oo.bobbin_1_id = b.id AND b.id <> c.id;

UPDATE public.fabric_receipt_item fri
SET    bobbin_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  fri.bobbin_id = b.id AND b.id <> c.id;

UPDATE public.opening_stock os
SET    bobbin_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  os.bobbin_id = b.id AND b.id <> c.id;

UPDATE public.bobbin_return br
SET    bobbin_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  br.bobbin_id = b.id AND b.id <> c.id;

UPDATE public.bobbin_stock bs
SET    bobbin_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  bs.bobbin_id = b.id AND b.id <> c.id;

UPDATE public.stock_ledger sl
SET    bobbin_id = c.id
FROM   public.bobbin b
JOIN   canonical_bobbin c USING (ends_per_bobbin)
WHERE  sl.bobbin_id = b.id AND b.id <> c.id;

-- 6) Delete the now-orphaned non-canonical bobbin rows.
DELETE FROM public.bobbin b
USING  canonical_bobbin c
WHERE  c.ends_per_bobbin = b.ends_per_bobbin AND b.id <> c.id;

-- 7) Rename surviving bobbin codes to BB-<ends>. Two-step rename so a
--    collision with an existing code (e.g. someone already had BB-36)
--    doesn't trip the UNIQUE constraint mid-update.
UPDATE public.bobbin b SET code = code || '#tmp140';
UPDATE public.bobbin b SET code = 'BB-' || b.ends_per_bobbin::text;

-- 8) Add the canonical link to bobbin_ends_master and enforce 1:1.
ALTER TABLE public.bobbin
  ADD COLUMN IF NOT EXISTS bobbin_ends_master_id bigint
    REFERENCES public.bobbin_ends_master(id);

UPDATE public.bobbin b
SET    bobbin_ends_master_id = m.id
FROM   public.bobbin_ends_master m
WHERE  m.ends_count = b.ends_per_bobbin;

ALTER TABLE public.bobbin
  ALTER COLUMN bobbin_ends_master_id SET NOT NULL;

-- One bobbin per ends-spec going forward.
ALTER TABLE public.bobbin
  ADD CONSTRAINT bobbin_unique_ends UNIQUE (ends_per_bobbin);

-- 9) Null out the purchase-shaped columns on bobbin since the data has
--    moved to bobbin_purchase. We keep the columns themselves so older
--    SELECT statements don't error; new purchases insert into
--    bobbin_purchase and these stay NULL.
UPDATE public.bobbin
SET    purchase_date = NULL,
       invoice_no    = NULL,
       bobbin_price  = 0;

COMMENT ON COLUMN public.bobbin.purchase_date IS 'DEPRECATED — use bobbin_purchase.purchase_date instead.';
COMMENT ON COLUMN public.bobbin.invoice_no    IS 'DEPRECATED — use bobbin_purchase.invoice_no instead.';
COMMENT ON COLUMN public.bobbin.bobbin_price  IS 'DEPRECATED — use bobbin_purchase.bobbin_price (varies per purchase).';

COMMIT;
