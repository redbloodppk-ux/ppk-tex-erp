-- ─────────────────────────────────────────────────────────────────────────
-- 022_loom_shed.sql
--
-- PPK TEX runs 56 power looms spread across 4 weaving sheds. The loom table
-- had no notion of which shed a loom sits in, and only a partial set of loom
-- rows had been seeded. This migration:
--
--   1. Adds loom.shed_no  (1-4) — the physical shed the loom stands in.
--   2. Grows the loom list up to 56 (L-01 .. L-56), adding any that are
--      missing as 56-inch power looms.
--   3. Assigns every loom to a shed, 14 looms per shed, in loom_code order:
--        Shed 1 = L-01..L-14   Shed 2 = L-15..L-28
--        Shed 3 = L-29..L-42   Shed 4 = L-43..L-56
--
-- Shed assignment is editable later from the Looms page in Settings, so this
-- only sets a sensible starting split. Idempotent: safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- 1. shed_no column ---------------------------------------------------------
ALTER TABLE loom
  ADD COLUMN IF NOT EXISTS shed_no smallint
    CHECK (shed_no IS NULL OR shed_no BETWEEN 1 AND 4);

COMMENT ON COLUMN loom.shed_no IS
  'Weaving shed (1-4) the loom physically sits in. Editable from Settings > Looms.';

-- 2. grow the loom list to 56 ----------------------------------------------
INSERT INTO loom (loom_code, loom_type, width_in, status)
SELECT 'L-' || lpad(g::text, 2, '0'), 'powerloom', 56, 'running'
FROM generate_series(1, 56) AS g
WHERE NOT EXISTS (
  SELECT 1 FROM loom l WHERE l.loom_code = 'L-' || lpad(g::text, 2, '0')
);

-- 3. assign sheds: 14 looms per shed, ordered by loom_code -----------------
WITH ranked AS (
  SELECT
    id,
    LEAST(
      ((row_number() OVER (ORDER BY loom_code) - 1) / 14)::int + 1,
      4
    ) AS shed
  FROM loom
)
UPDATE loom
SET    shed_no = ranked.shed
FROM   ranked
WHERE  loom.id = ranked.id;

COMMIT;
