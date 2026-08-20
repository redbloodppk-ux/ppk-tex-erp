-- 256_jobwork_ledger_classification.sql
--
-- Job work ledgers were classified as vendors we pay. They are not.
--
-- A Jobwork Party sends us THEIR material, we weave it and bill them, so
-- they owe us — a debtor. The 'JOB WORK(VENDOR)' ledger type and its
-- SUNDRY CREDITORS group are leftovers from the pre-05-Jun-2026 meaning,
-- when a "jobwork party" was a weaver we paid. Migration 113 split that
-- into kind='jobwork' / kind='outsource' on 05-Jun; migration 121
-- created these auto-ledgers on 06-Jun still carrying the old sense.
-- Same root cause as the dashboard bug fixed in 4325b3a.
--
-- Evidence: all 9 jobwork_invoice rows are bills WE raise, and the eight
-- to SRI MURUGAN TEX are settled with money RECEIVED.
--
-- WEAVING(VENDOR) under SUNDRY CREDITORS is left alone — an outsource
-- weaver really is a vendor we pay.
--
-- Nothing posts to these ledgers yet (0 of 94 invoices and 0 of 154
-- payments carry a ledger_id), so this corrects a latent fault before
-- double-entry posting is switched on and puts receivables on the
-- liabilities side of the trial balance.
--
-- NOT DONE HERE: removing the "duplicate" same-named ledgers. They are
-- not duplicates. Each party has one ledger per ACCOUNT and both are
-- referenced —
--   BMPT TEXTILES   LED-0006 <- party.ledger_id + customer.ledger_id
--                   LED-0198 <- jobwork_party.ledger_id + pavu.jobwork_ledger_id
--   SRI MURUGAN TEX LED-0002 <- party.ledger_id
--                   LED-0184 <- jobwork_party.ledger_id + pavu.jobwork_ledger_id
--   DEEPA TEX       LED-0183 <- party.ledger_id
--                   LED-0185 <- jobwork_party.ledger_id
-- That is exactly the per-account separation this project is building.
-- Deleting either would break references AND undo the separation. They
-- only LOOKED duplicated because they share a name, so the fix is to
-- make the names distinguishable.

-- ── 1. Rename the type to match what it actually is ──────────────────
update ledger_type
set name = 'JOB WORK(CUSTOMER)'
where name = 'JOB WORK(VENDOR)';

-- ── 2. Move those ledgers to Sundry Debtors ──────────────────────────
update ledger l
set group_id = (select id from ledger_group where upper(name) = 'SUNDRY DEBTORS' limit 1)
from ledger_type lt
where lt.id = l.type_id
  and lt.name = 'JOB WORK(CUSTOMER)'
  and (select id from ledger_group where upper(name) = 'SUNDRY DEBTORS' limit 1) is not null;

-- ── 3. Make the per-account ledgers tell themselves apart ────────────
update ledger l
set name = l.name || ' (Job Work)'
from ledger_type lt
where lt.id = l.type_id
  and lt.name = 'JOB WORK(CUSTOMER)'
  and l.name not like '% (Job Work)';

update ledger l
set name = l.name || ' (Outsource)'
from ledger_type lt
where lt.id = l.type_id
  and lt.name = 'WEAVING(VENDOR)'
  and l.name not like '% (Outsource)';

-- ── 4. Keep the auto-create trigger working ──────────────────────────
-- fn_jobwork_party_create_ledger looks the type up BY NAME, so the
-- rename above would otherwise make it silently stop creating ledgers
-- for new jobwork parties (v_type_id NULL -> early return). It also
-- copies group_id from an existing ledger of the type, so once step 2
-- has run, new jobwork ledgers inherit SUNDRY DEBTORS automatically.
-- Updated here to use the new type name and to apply the same
-- disambiguating suffix.
create or replace function public.fn_jobwork_party_create_ledger()
returns trigger
language plpgsql
as $function$
DECLARE
  v_type_name text;
  v_suffix    text;
  v_type_id   bigint;
  v_group_id  bigint;
  v_ledger_id bigint;
BEGIN
  IF NEW.ledger_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.kind = 'outsource' THEN
    v_type_name := 'WEAVING(VENDOR)';
    v_suffix    := ' (Outsource)';
  ELSE
    -- Renamed in migration 256: a jobwork party is a CUSTOMER of our
    -- weaving service, not a vendor.
    v_type_name := 'JOB WORK(CUSTOMER)';
    v_suffix    := ' (Job Work)';
  END IF;

  SELECT id INTO v_type_id FROM public.ledger_type WHERE name = v_type_name LIMIT 1;
  IF v_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT group_id INTO v_group_id
  FROM public.ledger
  WHERE type_id = v_type_id AND group_id IS NOT NULL
  LIMIT 1;

  INSERT INTO public.ledger (
    name, type_id, group_id,
    address1, phone, email, gstin,
    active
  ) VALUES (
    NEW.name || v_suffix, v_type_id, v_group_id,
    NEW.billing_address, NEW.phone, NEW.email, NEW.gstin,
    true
  ) RETURNING id INTO v_ledger_id;

  UPDATE public.jobwork_party SET ledger_id = v_ledger_id WHERE id = NEW.id;

  RETURN NEW;
END
$function$;
