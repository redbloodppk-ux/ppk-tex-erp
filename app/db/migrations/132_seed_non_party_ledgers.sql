-- 132_seed_non_party_ledgers.sql
-- Adds LOAN / INCOME / LIABILITY ledger types and seeds the common
-- non-party ledgers used by Bank Entries. Idempotent.

BEGIN;

-- Extra ledger types
INSERT INTO public.ledger_type (code, name, active) VALUES
  ('LT-0050', 'LOAN',      true),
  ('LT-0051', 'INCOME',    true),
  ('LT-0052', 'LIABILITY', true)
ON CONFLICT (code) DO NOTHING;

WITH lt AS (
  SELECT
    (SELECT id FROM ledger_type WHERE name = 'EXPENSES'  LIMIT 1) AS exp_id,
    (SELECT id FROM ledger_type WHERE name = 'LOAN'      LIMIT 1) AS loan_id,
    (SELECT id FROM ledger_type WHERE name = 'INCOME'    LIMIT 1) AS inc_id,
    (SELECT id FROM ledger_type WHERE name = 'LIABILITY' LIMIT 1) AS lia_id
),
lg AS (
  SELECT
    (SELECT id FROM ledger_group WHERE name = 'INDIRECT EXPENSES' LIMIT 1) AS ind_exp,
    (SELECT id FROM ledger_group WHERE name = 'INDIRECT INCOMES'  LIMIT 1) AS ind_inc,
    (SELECT id FROM ledger_group WHERE name = 'LOANS (LIABILITY)' LIMIT 1) AS loans_lia,
    (SELECT id FROM ledger_group WHERE name = 'DUTIES & TAXES'    LIMIT 1) AS duties
)
INSERT INTO public.ledger (name, type_id, group_id, active)
SELECT n, t, g, true
FROM lt, lg, (VALUES
  ('EB / ELECTRICITY EXPENSE',  (SELECT exp_id  FROM lt), (SELECT ind_exp   FROM lg)),
  ('BANK CHARGES EXPENSE',      (SELECT exp_id  FROM lt), (SELECT ind_exp   FROM lg)),
  ('LOAN INTEREST EXPENSE',     (SELECT exp_id  FROM lt), (SELECT ind_exp   FROM lg)),
  ('INSURANCE EXPENSE',         (SELECT exp_id  FROM lt), (SELECT ind_exp   FROM lg)),
  ('PROFESSIONAL FEES',         (SELECT exp_id  FROM lt), (SELECT ind_exp   FROM lg)),
  ('MAINTENANCE EXPENSE',       (SELECT exp_id  FROM lt), (SELECT ind_exp   FROM lg)),
  ('HDFC TERM LOAN',            (SELECT loan_id FROM lt), (SELECT loans_lia FROM lg)),
  ('VEHICLE LOAN',              (SELECT loan_id FROM lt), (SELECT loans_lia FROM lg)),
  ('INTEREST INCOME',           (SELECT inc_id  FROM lt), (SELECT ind_inc   FROM lg)),
  ('GST PAYABLE',               (SELECT lia_id  FROM lt), (SELECT duties    FROM lg)),
  ('TDS PAYABLE',               (SELECT lia_id  FROM lt), (SELECT duties    FROM lg))
) AS seeds(n, t, g)
WHERE NOT EXISTS (
  SELECT 1 FROM public.ledger l WHERE l.name = seeds.n
);

COMMIT;
