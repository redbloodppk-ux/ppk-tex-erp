-- Migration 040: CORR-P5 — link outsource_order to production_batch
--
-- Goal: when a vendor delivers outsourced fabric, that delivery must appear
-- as a production_batch row so True Cost, profit-by-quality, stock valuation
-- and other rollups (which iterate production_batch) include outsourced
-- metres automatically.
--
-- Design (Path A):
--   * Add production_batch.outsource_order_id (nullable FK).
--   * NULL  → in-house batch (woven on our looms, wage spread applies).
--   * SET   → outsource batch (woven by a vendor, no in-house wages, vendor
--             pick paise frozen into actual_pick_cost_per_m at delivery).
--   * loom_id is already nullable in schema, so no constraint relax needed.
--   * Wage allocation views (v_batch_wage_allocation) filter on loom_id IS
--     NOT NULL anyway, so outsource batches are naturally skipped.
--
-- Idempotent. Wrapped in a transaction.

BEGIN;

ALTER TABLE production_batch
  ADD COLUMN IF NOT EXISTS outsource_order_id bigint
    REFERENCES outsource_order(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_batch_outsource_order
  ON production_batch(outsource_order_id);

-- A production_batch is either in-house OR outsourced; never both.
-- In-house means it has a loom; outsourced means it does NOT have a loom
-- (and points at an outsource_order). We don't force the loom_id link
-- because historical batches may have been created before this rule.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'batch_source_exclusive'
  ) THEN
    ALTER TABLE production_batch
      ADD CONSTRAINT batch_source_exclusive
      CHECK (outsource_order_id IS NULL OR loom_id IS NULL);
  END IF;
END $$;

COMMENT ON COLUMN production_batch.outsource_order_id IS
  'CORR-P5: when set, this batch was woven by a vendor against the linked outsource_order. loom_id is NULL and wage allocation is skipped. Vendor pick paise is snapshotted into actual_pick_cost_per_m at delivery.';

-- Helper view: classifies each batch as in-house or outsourced for reports
-- that want to split the two streams.
DROP VIEW IF EXISTS public.v_production_batch_with_source CASCADE;

CREATE VIEW public.v_production_batch_with_source
WITH (security_invoker = on) AS
SELECT
  b.*,
  CASE
    WHEN b.outsource_order_id IS NOT NULL THEN 'outsource'
    ELSE 'inhouse'
  END AS source_kind,
  ow.ow_number,
  ow.vendor_id        AS outsource_vendor_id,
  v.name              AS outsource_vendor_name
FROM production_batch b
LEFT JOIN outsource_order ow ON ow.id = b.outsource_order_id
LEFT JOIN vendor v           ON v.id  = ow.vendor_id;

COMMENT ON VIEW public.v_production_batch_with_source IS
  'CORR-P5: production_batch rows tagged with source_kind (inhouse vs outsource) plus the linked OW number and vendor name when applicable.';

COMMIT;
