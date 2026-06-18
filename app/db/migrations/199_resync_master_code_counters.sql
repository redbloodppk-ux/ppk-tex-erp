-- 199_resync_master_code_counters.sql
--
-- Master code sequences (no {fy} in their format) accumulate codes forever.
-- A bulk import can insert rows with codes ahead of the doc_sequence counter
-- without advancing it, so the next auto-generated code collides with an
-- existing one (e.g. ledger_type sat at 16 while LT-0052 already existed,
-- which would have re-issued LT-0016 -> duplicate key).
--
-- Re-sync each live master counter to (highest existing PREFIX-#### code + 1).
-- GREATEST(...) makes this idempotent and never rewinds a counter.
-- mill / vendor doc_types are intentionally skipped — those tables were dropped
-- (migrations 056 / 098) and their sequence rows are dead.

UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^BB-(\d+)$'))[1]::int)   FROM bobbin             WHERE code ~ '^BB-\d+$'),0))   WHERE d.doc_type='bobbin';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(quality_code,'^COST-(\d+)$'))[1]::int) FROM costing_master WHERE quality_code ~ '^COST-\d+$'),0)) WHERE d.doc_type='costing';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^CUST-(\d+)$'))[1]::int) FROM customer           WHERE code ~ '^CUST-\d+$'),0)) WHERE d.doc_type='cust';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^EMP-(\d+)$'))[1]::int)  FROM employee           WHERE code ~ '^EMP-\d+$'),0))  WHERE d.doc_type='emp';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^EN-(\d+)$'))[1]::int)   FROM ends_master        WHERE code ~ '^EN-\d+$'),0))   WHERE d.doc_type='ends';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^FT-(\d+)$'))[1]::int)   FROM fabric_type_master WHERE code ~ '^FT-\d+$'),0))   WHERE d.doc_type='fabric_type';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^FQ-(\d+)$'))[1]::int)   FROM fabric_quality     WHERE code ~ '^FQ-\d+$'),0))   WHERE d.doc_type='fq';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^JWP-(\d+)$'))[1]::int)  FROM jobwork_party      WHERE code ~ '^JWP-\d+$'),0))  WHERE d.doc_type='jobwork_party';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^LED-(\d+)$'))[1]::int)  FROM ledger             WHERE code ~ '^LED-\d+$'),0))  WHERE d.doc_type='ledger';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^LG-(\d+)$'))[1]::int)   FROM ledger_group       WHERE code ~ '^LG-\d+$'),0))   WHERE d.doc_type='ledger_group';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^LT-(\d+)$'))[1]::int)   FROM ledger_type        WHERE code ~ '^LT-\d+$'),0))   WHERE d.doc_type='ledger_type';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^PRT-(\d+)$'))[1]::int)  FROM party              WHERE code ~ '^PRT-\d+$'),0))  WHERE d.doc_type='party';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^PT-(\d+)$'))[1]::int)   FROM party_type_master  WHERE code ~ '^PT-\d+$'),0))   WHERE d.doc_type='party_type';
UPDATE doc_sequence d SET next_value = GREATEST(d.next_value,
  1 + COALESCE((SELECT max((regexp_match(code,'^YC-(\d+)$'))[1]::int)   FROM yarn_count         WHERE code ~ '^YC-\d+$'),0))   WHERE d.doc_type='yc';
