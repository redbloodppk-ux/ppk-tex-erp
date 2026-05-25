-- ─────────────────────────────────────────────────────────────────────────
-- 023_shift_night_toggle.sql
--
-- Adds an on/off setting that controls whether the Shift Production Log
-- offers a Night shift in addition to the Day shift.
--
-- PPK TEX normally runs a single day shift, so this defaults to OFF. When
-- the owner turns it ON from Settings, the Day / Night buttons appear on
-- the Shift Log; when OFF those buttons are hidden and only the day shift
-- is recorded.
--
-- Stored as a single JSONB row in `system_config` under the key
-- `shift_log_night_enabled`, value shape:  { "enabled": false }
--
-- Idempotent: safe to re-run (ON CONFLICT keeps any value already set).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

INSERT INTO system_config (key, value, description)
VALUES (
  'shift_log_night_enabled',
  '{"enabled": false}'::jsonb,
  'When true, the Shift Production Log offers a Night shift as well as Day.'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
