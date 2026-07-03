-- ============================================================================
-- 226: Fix fn_pa_sync_pavu_status — a REMOVED assignment should restock the
-- pavu (back to 'in_stock', ready to be assigned again), not mark it
-- 'finished' (which means the beam is fully used up / done for good).
-- 'completed' still means finished — that behaviour is unchanged.
-- ============================================================================
CREATE OR REPLACE FUNCTION fn_pa_sync_pavu_status() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('queued','mounted','running') THEN
    UPDATE pavu SET status = 'on_loom'  WHERE id = NEW.pavu_id;
  ELSIF NEW.status = 'completed' THEN
    UPDATE pavu SET status = 'finished' WHERE id = NEW.pavu_id;
  ELSIF NEW.status = 'removed' THEN
    UPDATE pavu SET status = 'in_stock' WHERE id = NEW.pavu_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- Backfill: any pavu that is currently 'finished' solely because it was
-- REMOVED (not completed) under the old buggy trigger should be restocked.
UPDATE pavu p
SET status = 'in_stock'
WHERE p.status = 'finished'
  AND EXISTS (
    SELECT 1 FROM pavu_assign pa
    WHERE pa.pavu_id = p.id
    ORDER BY pa.id DESC
    LIMIT 1
  )
  AND (
    SELECT pa.status FROM pavu_assign pa
    WHERE pa.pavu_id = p.id
    ORDER BY pa.id DESC
    LIMIT 1
  ) = 'removed';
