-- ============================================================================
-- Migration 137 — Warp Ends column on opening_stock
-- ----------------------------------------------------------------------------
-- The in-house Warp Metre warehouse tab pivots inflows / outflows by
-- warp-ends count (pavu.ends) — NOT by fabric quality. The opening_stock
-- table was originally storing warp_beam openings keyed by
-- fabric_quality_id, which meant a hand-typed opening entry showed up on
-- a different column than the matching pavu inflow.
--
-- This adds a dedicated warp_ends integer column so opening entries for
-- the warp_beam bucket can be keyed the same way as pavu inflows, and
-- both land in the same column on the pivot.
--
-- The fabric_quality_id column is left in place for backward compat with
-- existing rows; the pivot loader prefers warp_ends when present.
-- ============================================================================

ALTER TABLE public.opening_stock
  ADD COLUMN IF NOT EXISTS warp_ends integer;

CREATE INDEX IF NOT EXISTS idx_opening_stock_warp_ends
  ON public.opening_stock(warp_ends)
  WHERE warp_ends IS NOT NULL;

COMMENT ON COLUMN public.opening_stock.warp_ends IS
  'Warp ends count (matches pavu.ends). Used to key warp_beam opening stock by ends instead of fabric quality.';
