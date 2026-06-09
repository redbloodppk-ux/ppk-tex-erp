-- 142_bobbin_per_mode.sql
--
-- Make the bobbin master mode-aware. Before this migration the bobbin
-- table was 1:1 with bobbin_ends_master (UNIQUE on ends_per_bobbin).
-- The new model: one bobbin row per (ends_master, production_mode), so
-- BB-IH-30, BB-JW-30 and BB-OS-30 can coexist as separate stock
-- balances for in-house / jobwork / outsource flows.
--
-- Existing in-house rows get the BB-IH-<ends> code; new rows for
-- jobwork or outsource are created from the new
-- /app/settings/bobbins page.

BEGIN;

ALTER TABLE public.bobbin DROP CONSTRAINT IF EXISTS bobbin_unique_ends;

UPDATE public.bobbin
SET    production_mode = 'inhouse'
WHERE  production_mode IS NULL OR production_mode = '';

ALTER TABLE public.bobbin ALTER COLUMN production_mode SET NOT NULL;

ALTER TABLE public.bobbin DROP CONSTRAINT IF EXISTS bobbin_mode_check;
ALTER TABLE public.bobbin ADD CONSTRAINT bobbin_mode_check
  CHECK (production_mode IN ('inhouse','jobwork','outsource'));

ALTER TABLE public.bobbin DROP CONSTRAINT IF EXISTS bobbin_unique_ends_mode;
ALTER TABLE public.bobbin ADD CONSTRAINT bobbin_unique_ends_mode
  UNIQUE (bobbin_ends_master_id, production_mode);

-- Rename existing in-house codes (BB-<ends>) to BB-IH-<ends>. Two-step
-- to avoid tripping the unique-on-code constraint mid-update if any
-- target code is already in use.
UPDATE public.bobbin
SET    code = code || '#tmp142'
WHERE  code = 'BB-' || ends_per_bobbin::text;

UPDATE public.bobbin
SET    code = 'BB-IH-' || ends_per_bobbin::text
WHERE  code = 'BB-' || ends_per_bobbin::text || '#tmp142';

COMMENT ON COLUMN public.bobbin.production_mode IS
  'Which production stream this bobbin belongs to: inhouse / jobwork / outsource. UNIQUE with bobbin_ends_master_id.';

COMMIT;
