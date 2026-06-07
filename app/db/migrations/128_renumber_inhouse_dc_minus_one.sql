-- 128_renumber_inhouse_dc_minus_one.sql
--
-- One-off data migration: shift every in-house DC code down by 1 so
-- the series starts at DC/26-27/0001 instead of DC/26-27/0002. The
-- original DC/26-27/0001 was deleted at some point and the gap was
-- bothersome; this closes it.
--
-- Mapping (30 rows):
--   DC/26-27/0002 → DC/26-27/0001
--   DC/26-27/0003 → DC/26-27/0002
--   …
--   DC/26-27/0031 → DC/26-27/0030
--
-- Approach: two-step rename via a TMP_DC/26-27/NNNN namespace so the
-- UNIQUE constraint on delivery_challan.code never sees a collision
-- mid-update. Re-runnable as a no-op: the second pass only matches
-- codes that still start with TMP_DC/26-27/.
--
-- After the rename we call fn_resync_doc_sequence('dc') (from mig 126)
-- to set the in-house DC counter to (new max) + 1 = 31. The next
-- saved in-house DC will be DC/26-27/0031, continuing the renumbered
-- series.
--
-- Safe-to-run because:
--   • No fabric_receipt.party_dc_no rows referenced these codes (checked
--     at design time).
--   • No invoice.notes / delivery_challan.notes string mentions either
--     (checked at design time).
--   • Only the delivery_challan.code column changes; FK references via
--     dc_id are id-based and unaffected.
--
-- Audit trail: the existing fn_audit_row trigger records every UPDATE,
-- so the rename is captured in audit_log for both passes. Intentional —
-- the renumber operation is itself a history-worthy change.

BEGIN;

-- Sanity: count before
DO $$
DECLARE before_n int;
BEGIN
  SELECT COUNT(*) INTO before_n
    FROM public.delivery_challan
   WHERE COALESCE(production_mode, 'inhouse') = 'inhouse'
     AND code ~ '^DC/26-27/[0-9]+$';
  RAISE NOTICE 'before: % inhouse DCs in DC/26-27/NNNN format', before_n;
END $$;

-- Step 1: rename DC/26-27/NNNN → TMP_DC/26-27/NNNN (number unchanged)
UPDATE public.delivery_challan
   SET code = 'TMP_DC/26-27/' || lpad(
       NULLIF(regexp_replace(code, '^DC/26-27/', ''), '')::int::text, 4, '0')
 WHERE COALESCE(production_mode, 'inhouse') = 'inhouse'
   AND code ~ '^DC/26-27/[0-9]+$';

-- Step 2: rename back to final DC/26-27/(N-1) value
UPDATE public.delivery_challan
   SET code = 'DC/26-27/' || lpad(
       (NULLIF(regexp_replace(code, '^TMP_DC/26-27/', ''), '')::int - 1)::text, 4, '0')
 WHERE COALESCE(production_mode, 'inhouse') = 'inhouse'
   AND code ~ '^TMP_DC/26-27/[0-9]+$';

-- Resync the counter so the next save is DC/26-27/(new max + 1).
SELECT public.fn_resync_doc_sequence('dc');

-- Sanity: after
DO $$
DECLARE
  after_n int;
  min_seq int;
  max_seq int;
  nv      int;
BEGIN
  SELECT COUNT(*),
         MIN((NULLIF(regexp_replace(code, '^DC/26-27/', ''), '')::int)),
         MAX((NULLIF(regexp_replace(code, '^DC/26-27/', ''), '')::int))
    INTO after_n, min_seq, max_seq
    FROM public.delivery_challan
   WHERE COALESCE(production_mode, 'inhouse') = 'inhouse'
     AND code ~ '^DC/26-27/[0-9]+$';
  SELECT next_value INTO nv FROM public.doc_sequence WHERE doc_type = 'dc';
  RAISE NOTICE 'after: % inhouse DCs, range %..%, doc_sequence next_value=%',
               after_n, min_seq, max_seq, nv;
END $$;

COMMIT;
