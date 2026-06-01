-- 063_fabric_quality_calc_snapshot.sql
--
-- Adds a single jsonb column to fabric_quality that stores the full
-- construction calculator state: warp/weft Ne, total ends, picks, loom
-- width, finished width, reed, tape length, bobbin selection, porvai
-- selection, towel toggle + length. Lets the edit page round-trip
-- every field without 20+ schema columns.

BEGIN;

ALTER TABLE public.fabric_quality
  ADD COLUMN IF NOT EXISTS calc_snapshot jsonb;

COMMENT ON COLUMN public.fabric_quality.calc_snapshot IS
  'Full construction Calculator input snapshot saved at the time the fabric was created/updated. Drives the edit page so every field round-trips.';

COMMIT;
