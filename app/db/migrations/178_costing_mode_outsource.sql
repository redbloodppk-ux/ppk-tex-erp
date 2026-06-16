-- 178_costing_mode_outsource.sql
--
-- Fabric Costing now distinguishes between TWO modes:
--   inhouse   - mill does the weaving (uses picks-per-inch x paise)
--   outsource - outsource weaver does the weaving (direct Rs/m rate)
--
-- The existing `production_mode` enum on costing_master had a legacy
-- shape (`inhouse / vendor / both`) which never matched real workflow.
-- This migration:
--   1. Adds a new `outsource` value to the enum.
--   2. Backfills any old 'vendor' or 'both' rows to 'outsource' so the
--      list page can render them under the new label without a NULL
--      hop.
--   3. Leaves the legacy 'vendor' and 'both' values in the enum so any
--      historical reference doesn't blow up — but the Fabric Costing
--      form will only ever write 'inhouse' or 'outsource' going
--      forward.
--
-- Jobwork is intentionally OUT of costing_master — see Phase 2 for the
-- fabric_quality.pick_cost_per_m flow that powers Job work P&L.

BEGIN;

-- Postgres allows ALTER TYPE ADD VALUE inside a transaction since
-- v12, but the new literal can't be USED (in a CHECK / UPDATE) until
-- the txn commits. That's why the backfill runs in a SECOND
-- transaction (block below).
ALTER TYPE production_mode ADD VALUE IF NOT EXISTS 'outsource';

COMMIT;

-- Backfill any legacy values into 'outsource'.
BEGIN;

UPDATE public.costing_master
SET production_mode = 'outsource'
WHERE production_mode IN ('vendor', 'both');

COMMIT;
