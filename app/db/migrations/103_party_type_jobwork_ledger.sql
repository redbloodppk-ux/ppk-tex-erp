-- 103_party_type_jobwork_ledger.sql
--
-- The "Jobwork Party" party type was wired to the WEAVING(VENDOR)
-- ledger type back in migration 072. That made jobwork parties and
-- outsource weavers share the same ledger bucket, which conflated two
-- distinct accounting flows. Repoint Jobwork Party to its own
-- JOB WORK(VENDOR) ledger type (already present in ledger_type
-- master) so each party type maps cleanly to a dedicated ledger type:
--
--   Customer             → CUSTOMER          (SUNDRY DEBTORS)
--   Mill / Yarn Supplier → SUPPLIER          (SUNDRY CREDITORS)
--   Jobwork Party        → JOB WORK(VENDOR)  (SUNDRY CREDITORS)   ← THIS migration
--   Sizing Party         → SIZING(VENDOR)    (SUNDRY CREDITORS)
--   Outsource Weaver     → WEAVING(VENDOR)   (SUNDRY CREDITORS)
--   Bobbin Supplier      → SUPPLIER          (SUNDRY CREDITORS)
--   Broker / Agent       → AGENT             (SUNDRY CREDITORS)
--   Shipping             → TRANSPORT         (INDIRECT EXPENSES)
--   Rental               → RENTAL            (INDIRECT EXPENSES)

BEGIN;

UPDATE public.party_type_master pt
   SET ledger_type_id  = lt.id,
       ledger_group_id = lg.id
  FROM public.ledger_type  lt,
       public.ledger_group lg
 WHERE pt.name = 'Jobwork Party'
   AND lt.name = 'JOB WORK(VENDOR)'
   AND lg.name = 'SUNDRY CREDITORS';

COMMIT;
