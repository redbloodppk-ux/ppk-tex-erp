-- 111_fabric_purchase_unified_qty.sql
--
-- Simplify fabric_purchase so the form can have a single
-- "Quantity (metres/pcs)" field driven by the rate_unit dropdown.
-- Whichever unit the operator picks, that column gets the value and
-- the other stays NULL.
--
-- Changes:
--   * received_metres becomes NULLABLE.
--   * A row-level CHECK ensures at least one of received_metres /
--     received_pieces is > 0.
--   * total_amount stays GENERATED — same formula as before, with
--     NULL handling for the inactive column.
--   * current_metres becomes NULLABLE too, defaulting to
--     received_metres when present.

BEGIN;

-- 1. Drop the existing GENERATED total_amount so we can adjust the
--    underlying NOT NULL constraint cleanly.
ALTER TABLE public.fabric_purchase DROP COLUMN IF EXISTS total_amount;

-- 2. Relax the NOT NULL + CHECK on received_metres so per-piece
--    purchases can omit metres entirely.
ALTER TABLE public.fabric_purchase
  ALTER COLUMN received_metres DROP NOT NULL;

-- The original CHECK (received_metres > 0) is auto-named; drop it if
-- present, then add a tolerant version.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.fabric_purchase'::regclass
       AND contype  = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%received_metres%'
  LOOP
    EXECUTE format('ALTER TABLE public.fabric_purchase DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.fabric_purchase
  ADD CONSTRAINT chk_fabric_purchase_quantity
  CHECK (
    (rate_unit = 'm'   AND received_metres IS NOT NULL AND received_metres > 0)
    OR
    (rate_unit = 'pcs' AND received_pieces IS NOT NULL AND received_pieces > 0)
  );

-- 3. current_metres can be NULL for per-piece purchases.
ALTER TABLE public.fabric_purchase
  ALTER COLUMN current_metres DROP NOT NULL;

-- 4. Re-add total_amount as a GENERATED column with NULL-safe inputs.
ALTER TABLE public.fabric_purchase
  ADD COLUMN total_amount numeric(14,2) GENERATED ALWAYS AS (
    CASE rate_unit
      WHEN 'm'   THEN ROUND(COALESCE(received_metres, 0) * rate * (1 + gst_pct / 100), 2)
      WHEN 'pcs' THEN ROUND(COALESCE(received_pieces, 0) * rate * (1 + gst_pct / 100), 2)
    END
  ) STORED;

COMMIT;
