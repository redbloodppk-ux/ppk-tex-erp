-- 081_party_multi_type.sql
--
-- Adds party.party_type_ids (bigint[]) so a single party row can belong
-- to multiple types - e.g. the same business that buys finished fabric
-- from us AND supplies us with bobbins should be one record, not two.
--
-- The legacy party_type_id column stays in place and is kept in sync
-- with the first element of party_type_ids via a trigger, so older code
-- paths that read party_type_id keep working without churn.

BEGIN;

ALTER TABLE public.party
  ADD COLUMN IF NOT EXISTS party_type_ids bigint[] NOT NULL DEFAULT '{}'::bigint[];

UPDATE public.party
   SET party_type_ids = ARRAY[party_type_id]::bigint[]
 WHERE party_type_id IS NOT NULL
   AND cardinality(party_type_ids) = 0;

CREATE INDEX IF NOT EXISTS idx_party_party_type_ids
  ON public.party USING GIN (party_type_ids);

COMMENT ON COLUMN public.party.party_type_ids IS
  'Array of party_type_master.id - allows one party to belong to multiple types (Customer + Bobbin Supplier on the same row). Legacy party_type_id stays in sync with the first element for backward compatibility.';

CREATE OR REPLACE FUNCTION public.fn_party_sync_legacy_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.party_type_ids IS NOT NULL AND cardinality(NEW.party_type_ids) > 0 THEN
    NEW.party_type_id := NEW.party_type_ids[1];
  END IF;
  IF (NEW.party_type_ids IS NULL OR cardinality(NEW.party_type_ids) = 0)
     AND NEW.party_type_id IS NOT NULL THEN
    NEW.party_type_ids := ARRAY[NEW.party_type_id]::bigint[];
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_party_sync_legacy_type ON public.party;
CREATE TRIGGER trg_party_sync_legacy_type
  BEFORE INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_party_sync_legacy_type();

COMMIT;
