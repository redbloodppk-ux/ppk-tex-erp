-- ────────────────────────────────────────────────────────────────────────────
-- Migration 004 — Security hardening (CORR-F5)
-- ────────────────────────────────────────────────────────────────────────────
-- Closes the gaps raised by Supabase's security advisor:
--   1. 7 views default to SECURITY DEFINER → flip to SECURITY INVOKER so they
--      honour RLS of the calling user.
--   2. notification INSERT policy `WITH CHECK true` lets any logged-in user
--      forge notifications for any other user → tighten to user_id=auth.uid().
--   3. 11 functions have a mutable search_path → pin to (public, pg_temp) to
--      block search_path hijacking attacks on SECURITY DEFINER paths.
--   4. Trigger-only SECURITY DEFINER functions (fn_audit_row,
--      fn_autogen_code) shouldn't be callable by app roles → REVOKE EXECUTE.
--   5. Role-helper SECURITY DEFINER functions stay EXECUTEable by
--      `authenticated` (RLS policies invoke them) but are revoked from `anon`.
--
-- Safe to re-run: every statement is idempotent.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Views: switch to SECURITY INVOKER so RLS of caller is enforced ──────
ALTER VIEW public.v_costing_computed     SET (security_invoker = on);
ALTER VIEW public.v_costing_two_cost     SET (security_invoker = on);
ALTER VIEW public.v_customer_outstanding SET (security_invoker = on);
ALTER VIEW public.v_looms_overhead       SET (security_invoker = on);
ALTER VIEW public.v_sizing_job_balance   SET (security_invoker = on);
ALTER VIEW public.v_yarn_days_of_cover   SET (security_invoker = on);
ALTER VIEW public.v_yarn_weighted_avg    SET (security_invoker = on);

-- ── 2. notification INSERT policy: only allow inserting rows for self ──────
DROP POLICY IF EXISTS p_notif_insert ON public.notification;
CREATE POLICY p_notif_insert
  ON public.notification
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ── 3. Pin search_path on every application function ───────────────────────
-- (Extension-provided functions like gbt_*, gtrgm_*, similarity_* are left
--  alone — they ship with their own correct settings.)
ALTER FUNCTION public.can_write_master(text)        SET search_path = public, pg_temp;
ALTER FUNCTION public.current_user_role()           SET search_path = public, pg_temp;
ALTER FUNCTION public.is_owner_or_auditor()         SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_audit_row()                SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_autogen_code()             SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_invoice_auto_no()          SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_next_doc_no(text)          SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_pa_sync_pavu_status()      SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_pavu_autogen_code()        SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_set_updated_at()           SET search_path = public, pg_temp;
ALTER FUNCTION public.fn_sizing_autogen_code()      SET search_path = public, pg_temp;

-- ── 4. Trigger-only SECURITY DEFINER functions: revoke direct EXECUTE ──────
-- Triggers fire under the table-owner's rights regardless of grants, so
-- nothing breaks. Removing EXECUTE for app roles closes a privilege-escalation
-- vector (any logged-in user could otherwise write arbitrary audit rows).
REVOKE EXECUTE ON FUNCTION public.fn_audit_row()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_autogen_code() FROM PUBLIC, anon, authenticated;

-- ── 5. Role-helper functions: keep for `authenticated`, drop from `anon` ───
-- RLS policies call these in USING/WITH CHECK clauses, so `authenticated`
-- must still have EXECUTE. There is no reason for the public/anon role to be
-- able to invoke them.
REVOKE EXECUTE ON FUNCTION public.current_user_role()        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_or_auditor()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_write_master(text)     FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.current_user_role()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_owner_or_auditor()      TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_write_master(text)     TO authenticated;

COMMIT;
