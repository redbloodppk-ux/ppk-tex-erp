-- 108_backfill_party_from_ledger.sql
--
-- Every active accounting ledger whose type is wired to a party_type
-- (e.g. AGENT → Broker / Agent, SUPPLIER → Mill / Yarn Supplier,
-- SIZING(VENDOR) → Sizing Party, etc.) should have a matching row in
-- the unified `party` table. The Payments page, Invoice forms, and
-- the new Ledger View tab all key off party_type_ids, so any ledger
-- without a party is effectively invisible in those flows.
--
-- This migration scans every ledger that:
--   1. Has a ledger_type that maps to a party_type (via
--      party_type_master.ledger_type_id), AND
--   2. Doesn't already have a party row pointing back at it.
--
-- For each, it inserts a new party row tagged with the right
-- party_type and linked by ledger_id. The fn_autogen_code trigger
-- fills in the PRT-NNNN code automatically.

BEGIN;

INSERT INTO public.party (
  name, party_type_id, party_type_ids,
  billing_address, ledger_id, status
)
SELECT
  l.name,
  pt.id,
  ARRAY[pt.id]::bigint[],
  COALESCE(NULLIF(l.address1, ''), '') AS billing_address,
  l.id,
  'active'::public.record_status
FROM public.ledger l
JOIN public.ledger_type lt ON lt.id = l.type_id
JOIN public.party_type_master pt ON pt.ledger_type_id = lt.id
WHERE l.active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.party p WHERE p.ledger_id = l.id
  );

COMMIT;
