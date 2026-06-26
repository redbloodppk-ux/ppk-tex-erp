-- 222_production_batch_mode_party.sql
--
-- Phase 1 of the Production Batch "production mode" feature.
--
-- A batch can now be created for one of three weaving modes:
--   inhouse   — own warp + own loom (the only mode supported until now)
--   jobwork   — customer-owned yarn, woven by an external Jobwork Party
--   outsource — own yarn, woven by an external Outsource Weaver
--
-- jobwork / outsource batches carry a party_id pointing at the weaver in
-- the party master. inhouse batches leave party_id NULL.
--
-- The stock / costing behaviour is identical for all three modes in this
-- phase; the mode + party are recorded so later phases can route the
-- produced fabric to the right warehouse tab.

ALTER TABLE production_batch
  ADD COLUMN IF NOT EXISTS production_mode text NOT NULL DEFAULT 'inhouse',
  ADD COLUMN IF NOT EXISTS party_id        bigint REFERENCES party(id);

-- Guard the allowed mode values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_batch_production_mode_chk'
  ) THEN
    ALTER TABLE production_batch
      ADD CONSTRAINT production_batch_production_mode_chk
      CHECK (production_mode IN ('inhouse', 'jobwork', 'outsource'));
  END IF;
END $$;

-- Helpful index for the production list mode filter.
CREATE INDEX IF NOT EXISTS idx_production_batch_production_mode
  ON production_batch (production_mode);
