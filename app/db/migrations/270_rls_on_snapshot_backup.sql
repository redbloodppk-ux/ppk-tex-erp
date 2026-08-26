-- 270_rls_on_snapshot_backup.sql
--
-- Closes the CRITICAL finding in Supabase's security advisor email of
-- 2026-08-26: rls_disabled_in_public.
--
-- WHAT WAS OPEN
-- `fabric_receipt_snapshot_backup` was created by migration 252 as a
-- safety copy of the 98 receipt snapshots before the warp rebuild. It was
-- created with a plain CREATE TABLE and never given Row-Level Security,
-- so unlike every other table in this database it had no lock on it at
-- all.
--
-- That matters because the anon key is PUBLIC - it ships inside the
-- browser bundle of the app, by design. RLS is what stands between that
-- public key and the data. With RLS off, anyone holding the project URL
-- and that key could read, change or delete all 98 rows.
--
-- HOW BAD, HONESTLY
-- Limited. One table, no personal data, no money, and only a backup copy -
-- the live receipts in `fabric_receipt` were protected throughout. The
-- realistic worst case is someone wiping the undo copy of a correction,
-- not touching the books. But it was a genuinely open door, and the next
-- table created the same careless way might hold something that matters.
--
-- THE LESSON
-- CREATE TABLE does not enable RLS. Every other table here got it because
-- its migration said so explicitly. This one was written in a hurry during
-- a data fix and skipped it. Supabase's advisor caught what review did
-- not - worth keeping those weekly emails switched on.
--
-- POLICIES
-- Same shape as the tables it copies from: read for the roles that can see
-- receipts, write for the owner only. It is a frozen audit copy, so even
-- the owner should have no reason to change it - but leaving it writable
-- by the owner keeps a mistake fixable without another migration.
--
-- NOT DROPPED. The rebuild these rows underwrite is what several current
-- warp figures rest on. Keeping the originals means that correction can
-- still be audited later; deleting them to close a security warning would
-- be solving the wrong problem.

BEGIN;

ALTER TABLE public.fabric_receipt_snapshot_backup ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_frs_backup_read ON public.fabric_receipt_snapshot_backup;
CREATE POLICY p_frs_backup_read ON public.fabric_receipt_snapshot_backup
  FOR SELECT USING (
    public.current_user_role() = ANY (ARRAY[
      'owner'::user_role, 'auditor'::user_role,
      'mill_manager'::user_role, 'accounts'::user_role
    ])
  );

DROP POLICY IF EXISTS p_frs_backup_write ON public.fabric_receipt_snapshot_backup;
CREATE POLICY p_frs_backup_write ON public.fabric_receipt_snapshot_backup
  FOR ALL USING (public.current_user_role() = 'owner'::user_role);

COMMIT;

-- Verify: this should return no rows.
--   select c.relname from pg_class c
--   join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false;
--
-- Note on auto_backup: it reports RLS enabled with ZERO policies, which
-- looks alarming and is in fact the safest possible state - deny all. It
-- is read only through createServiceClient() (the service-role key, server
-- side), which bypasses RLS by design. Deliberate, leave it alone.
