-- 086_dc_entry_mode.sql
--
-- DC entry mode toggle. The form supports two flavours:
--
--   detailed - hierarchical bundle/piece breakdown (default, pre-existing
--              behaviour). Each bundle is a column, each piece is a row.
--              Totals roll up automatically.
--   summary  - flat totals per item only (fabric quality + total metres
--              + total pieces + total bundles). Faster entry when the
--              breakdown doesn't matter, e.g. resale dispatches or
--              when the customer doesn't ask for piece-wise lengths.
--
-- The print template uses this column to decide whether to render the
-- bundle grid or skip straight to the totals row.

ALTER TABLE public.delivery_challan
  ADD COLUMN IF NOT EXISTS entry_mode text NOT NULL DEFAULT 'detailed';

ALTER TABLE public.delivery_challan DROP CONSTRAINT IF EXISTS delivery_challan_entry_mode_check;
ALTER TABLE public.delivery_challan ADD CONSTRAINT delivery_challan_entry_mode_check
  CHECK (entry_mode IN ('detailed', 'summary'));

COMMENT ON COLUMN public.delivery_challan.entry_mode IS
  'How items were captured: detailed bundle/piece grid OR summary totals only.';
