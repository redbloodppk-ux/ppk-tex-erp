-- 157_drop_tier1_dead_tables.sql
--
-- Schema cleanup — Tier 1 drops.
--
-- These three tables were verified dead in the Tier 1 audit:
--
--   • zero rows in production
--   • zero references in the application code
--     (only mentioned in the auto-generated lib/database.types.ts
--      and in db/rls.sql)
--   • zero foreign keys pointing TO them
--   • zero views referencing them
--   • zero functions referencing them
--
-- After the drop the next `supabase gen types` run will produce a
-- database.types.ts that no longer mentions them, so the lingering
-- entries in that file will disappear naturally on the next
-- regeneration. The rls.sql file is the original setup script — it's
-- left as-is, since re-running it on a fresh database would just
-- error on the missing tables, which is what we want.
--
-- No CASCADE is used: if anything unexpectedly depends on these
-- tables this migration will fail cleanly rather than silently
-- dropping the dependent object.

DROP TABLE IF EXISTS public.customer_price_history;
DROP TABLE IF EXISTS public.dc_line;
DROP TABLE IF EXISTS public.report_export;
