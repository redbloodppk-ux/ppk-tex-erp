-- 091_fabric_receipt_stock_snapshot.sql
--
-- Adds a per-receipt before/after snapshot to fabric_receipt so each
-- saved receipt becomes a self-contained stock transaction record.
-- The snapshot captures the pooled stock balance (across merged-
-- delivery siblings) for the four jobwork buckets at the moment of
-- save, both before and after the reductions have been applied.
--
-- Shape:
--   {
--     "warp_beam":   { "before_m":  50740, "consumed_m":  2500, "after_m":  48240 },
--     "weft_yarn":   { "before_kg": 1200,  "consumed_kg": 50,   "after_kg": 1150  },
--     "porvai_yarn": { "before_kg": 400,   "consumed_kg": 20,   "after_kg": 380   },
--     "bobbin":      { "before_pcs":5000,  "consumed_pcs":30,   "after_pcs":4970  }
--   }
--
-- The /app/jobwork/fabric-receipt/[id] detail page reads this column
-- to render the transaction summary. A new /app/jobwork/fabric-receipt
-- list page surfaces it as a tabular report across all receipts.

BEGIN;

ALTER TABLE public.fabric_receipt
  ADD COLUMN IF NOT EXISTS stock_snapshot jsonb;

COMMIT;
