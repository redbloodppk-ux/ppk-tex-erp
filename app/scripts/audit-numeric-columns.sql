-- ============================================================================
-- audit-numeric-columns.sql  (CORR-F2)
-- ----------------------------------------------------------------------------
-- Per Correction Guide v1.1 R4: every money column must be Postgres
-- numeric(15,2) and every weight column numeric(10,3) (or wider precision,
-- as long as the underlying type is numeric — never float8 / double precision
-- / real). This script lists every suspect column and its data type so the
-- owner can verify zero violations.
--
-- Run in Supabase SQL editor (or psql) and copy the result into the
-- migration PR description as proof of compliance.
-- ============================================================================

SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.numeric_precision,
  c.numeric_scale,
  CASE
    WHEN c.data_type IN ('double precision', 'real') THEN 'VIOLATION_float'
    WHEN c.column_name ~* '(price|cost|amount|rate|paise)' AND
         (c.data_type <> 'numeric' OR c.numeric_precision < 8)
      THEN 'CHECK_money_precision'
    WHEN c.column_name ~* '(kg|meter|metre|gram)' AND c.data_type <> 'numeric'
      THEN 'VIOLATION_weight_not_numeric'
    ELSE 'OK'
  END AS verdict
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
       c.column_name ~* '(price|cost|amount|rate|paise|kg|meter|metre|gram)'
       OR c.data_type IN ('double precision', 'real')
  )
ORDER BY verdict DESC, c.table_name, c.column_name;

-- ----------------------------------------------------------------------------
-- Expected verdict for all rows: 'OK' (zero VIOLATION_* rows).
-- If any VIOLATION_* row appears, create a migration in
--   supabase/migrations/NNNN_money_numeric_types.sql
-- that ALTERs the offending column to numeric(15,2) for money or
-- numeric(10,3) for weight.
-- ----------------------------------------------------------------------------
