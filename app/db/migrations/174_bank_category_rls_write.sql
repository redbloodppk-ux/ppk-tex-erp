-- 174_bank_category_rls_write.sql
--
-- Bank Entry form has an inline "+ Add new category" affordance — the
-- operator can mint a fresh `bank_category` row straight from the picker.
-- Migration 131 enabled RLS on `bank_category` but only added a SELECT
-- policy, so the client-side INSERT failed with:
--   "new row violates row-level security policy for table 'bank_category'"
--
-- Add the standard write policy used across every other master-data
-- table (party, fabric_type_master, jobwork_party, …) so authenticated
-- users can insert / update / delete categories. Same `USING (true)
-- WITH CHECK (true)` pattern — single-tenant app, no per-row access
-- control to enforce here.
--
BEGIN;

DROP POLICY IF EXISTS p_bank_category_modify ON public.bank_category;
CREATE POLICY p_bank_category_modify
  ON public.bank_category
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;
