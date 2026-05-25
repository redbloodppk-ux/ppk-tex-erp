-- 025_attendance_audit_triggers.sql — CORR-A4
--
-- Every change to attendance must leave a before/after trail. The
-- audit_log table can only be written by a SECURITY DEFINER trigger
-- (it has no client INSERT policy), so we attach the existing
-- fn_audit_row() trigger function to the two attendance tables.
--
-- fn_audit_row() records table_name, row_pk (from the row's id),
-- action, old_data, new_data and auth.uid() into audit_log.
--
-- Idempotent: drops the triggers first so re-running is safe.

DROP TRIGGER IF EXISTS trg_audit_attendance_entry ON attendance_entry;
CREATE TRIGGER trg_audit_attendance_entry
  AFTER INSERT OR UPDATE OR DELETE ON attendance_entry
  FOR EACH ROW
  EXECUTE FUNCTION fn_audit_row();

DROP TRIGGER IF EXISTS trg_audit_attendance_day ON attendance_day;
CREATE TRIGGER trg_audit_attendance_day
  AFTER INSERT OR UPDATE OR DELETE ON attendance_day
  FOR EACH ROW
  EXECUTE FUNCTION fn_audit_row();
