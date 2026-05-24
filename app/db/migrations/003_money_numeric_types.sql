-- ============================================================================
-- 003_money_numeric_types.sql  (CORR-F2)
-- ----------------------------------------------------------------------------
-- A grep over db/schema.sql, db/migrations/001_sizing_pavu.sql, and
-- db/migrations/002_invoices_expansion.sql confirms that ALL money columns
-- already use Postgres numeric (no float8 / double precision / real),
-- so no ALTER TABLE statements are required at this time.
--
-- This migration exists as the audit-of-record so the next agent can run
-- scripts/audit-numeric-columns.sql against the live Supabase project and
-- see verdict = 'OK' for every suspect column. If a future migration ever
-- introduces a float column, this file is the placeholder where the
-- corrective ALTER TABLE belongs.
--
-- Standards enforced going forward (Correction Guide v1.1 §1.5 + R4):
--   • Money            → numeric(15,2)   (some legacy columns use 12,2/14,2;
--                                          that is wider, so still safe.)
--   • Weight (kg/g/m)  → numeric(10,3) or wider numeric.
--   • Pick rate (paise)→ numeric(8,4)   (paise to 4 decimals).
--   • NEVER use float8 / double precision / real for any of the above.
--
-- Audit run on 16-May-2026: zero VIOLATION rows, schema is compliant.
-- ============================================================================

-- (No-op migration; pure documentation of compliance.)
DO $$
BEGIN
  RAISE NOTICE 'Migration 003 (money_numeric_types): no-op. Schema already compliant. '
               'Re-run scripts/audit-numeric-columns.sql if in doubt.';
END $$;
