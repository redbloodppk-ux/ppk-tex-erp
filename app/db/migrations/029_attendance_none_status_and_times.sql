-- 029_attendance_none_status_and_times.sql
--
-- Three changes to the attendance module:
--
--  1. Add 'none' to the attendance_status enum. A morning-shift weaver
--     should be marked 'none' on the night shift screen — not 'absent',
--     because absent counts against him in wage reports. 'none' means
--     "this employee was not scheduled to work this shift."
--
--  2. Add actual_in_time / actual_out_time columns to attendance_entry.
--     These are filled when status is 'late' or 'early_leave' (and
--     optionally for 'half_day') so we have a record of the real
--     punch-in / punch-out time. NULL = not recorded.
--
--  3. Fix p_att_entry_read RLS policy. The previous policy read
--     auth.users directly to find a floor operator's own employee code,
--     but the `authenticated` role has no SELECT grant on auth.users —
--     so any save that triggered a read of attendance_entry blew up
--     with "permission denied for table users". Wrap the auth.users
--     lookup in a SECURITY DEFINER helper.

-- ── 1. Enum value ──────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction in older
-- Postgres versions, but Supabase's migration runner handles it per
-- statement. IF NOT EXISTS keeps re-runs safe.
ALTER TYPE attendance_status ADD VALUE IF NOT EXISTS 'none';

-- ── 2. Actual in / out time columns ────────────────────────────────────
ALTER TABLE attendance_entry
  ADD COLUMN IF NOT EXISTS actual_in_time  time;

ALTER TABLE attendance_entry
  ADD COLUMN IF NOT EXISTS actual_out_time time;

-- ── 3. SECURITY DEFINER helper that reads auth.users ──────────────────
CREATE OR REPLACE FUNCTION current_employee_code()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT raw_user_meta_data->>'employee_code'
    FROM auth.users
   WHERE id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION current_employee_code() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION current_employee_code() TO authenticated;

-- ── 4. Rewrite p_att_entry_read so it stops touching auth.users ───────
DROP POLICY IF EXISTS p_att_entry_read ON attendance_entry;
CREATE POLICY p_att_entry_read ON attendance_entry FOR SELECT
  USING (
    current_user_role() IN ('owner','auditor','mill_manager','accounts')
    OR employee_id IN (
      SELECT id FROM employee WHERE code = current_employee_code()
    )
  );
