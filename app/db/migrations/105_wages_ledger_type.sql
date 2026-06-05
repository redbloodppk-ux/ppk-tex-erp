-- 105_wages_ledger_type.sql
--
-- Add a dedicated WAGES ledger type so payroll expenses (weaver
-- wages, sizing wages, office salaries, etc.) get tagged to the
-- correct accounting bucket instead of being lumped under generic
-- "INDIRECT EXPENSES". The code column is auto-filled by
-- fn_autogen_code (migration 071).
--
-- After this migration the operator can create as many WAGES-type
-- ledgers as they like via /app/ledgers/new — the new ledger filter
-- on the Ledgers page makes it easy to see them all at once.

BEGIN;

INSERT INTO public.ledger_type (name, active)
SELECT 'WAGES', true
 WHERE NOT EXISTS (SELECT 1 FROM public.ledger_type WHERE name = 'WAGES');

COMMIT;
