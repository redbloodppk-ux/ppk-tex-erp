-- 205_party_ledger_address_split_and_sync.sql
--
-- Follow-up to 204. Two parts:
--
--   A) Data backfill — older parties/ledgers (CSV imports, pre-structured
--      records) still have the whole postal address crammed into a single
--      field as a comma-joined blob, with address2/3/4 empty. Split that
--      blob on its comma delimiter (the same separator billing_address was
--      joined with) into the four structured lines, for both party and the
--      linked ledger. Only rows whose lines 2-4 are all empty are touched,
--      so already-correct and manually-edited rows are left alone.
--
--   B) Edit sync — until now only party INSERT created/seeded the ledger
--      (migration 072). Editing a party's address never propagated to its
--      linked ledger. Add an AFTER UPDATE trigger so the ledger's
--      address1..4 stay in sync whenever the party's address lines change.

BEGIN;

-- ── A1. Split the blob into party.address1..4 ────────────────────────────
WITH parts AS (
  SELECT id,
         array_remove(
           ARRAY(
             SELECT btrim(x)
             FROM unnest(string_to_array(
               COALESCE(NULLIF(billing_address, ''), address1), ','
             )) AS x
           ), ''
         ) AS arr
  FROM public.party
  WHERE address2 IS NULL AND address3 IS NULL AND address4 IS NULL
    AND COALESCE(NULLIF(billing_address, ''), address1) LIKE '%,%'
)
UPDATE public.party p
SET address1 = parts.arr[1],
    address2 = parts.arr[2],
    address3 = parts.arr[3],
    address4 = CASE WHEN array_length(parts.arr, 1) > 4
                    THEN array_to_string(parts.arr[4:array_length(parts.arr, 1)], ', ')
                    ELSE parts.arr[4] END
FROM parts
WHERE p.id = parts.id
  AND array_length(parts.arr, 1) >= 2;

-- ── A2. Copy the now-split party lines onto the linked ledger ────────────
UPDATE public.ledger l
SET    address1 = NULLIF(p.address1, ''),
       address2 = NULLIF(p.address2, ''),
       address3 = NULLIF(p.address3, ''),
       address4 = NULLIF(p.address4, '')
FROM   public.party p
WHERE  p.ledger_id = l.id
  AND  COALESCE(NULLIF(p.address2, ''), NULLIF(p.address3, ''), NULLIF(p.address4, '')) IS NOT NULL
  AND  l.address2 IS NULL
  AND  l.address3 IS NULL
  AND  l.address4 IS NULL;

-- ── A3. Ledgers with no linked party — split their own blob ──────────────
WITH parts AS (
  SELECT id,
         array_remove(
           ARRAY(SELECT btrim(x) FROM unnest(string_to_array(address1, ',')) AS x), ''
         ) AS arr
  FROM public.ledger
  WHERE address2 IS NULL AND address3 IS NULL AND address4 IS NULL
    AND address1 LIKE '%,%'
    AND id NOT IN (SELECT ledger_id FROM public.party WHERE ledger_id IS NOT NULL)
)
UPDATE public.ledger l
SET address1 = parts.arr[1],
    address2 = parts.arr[2],
    address3 = parts.arr[3],
    address4 = CASE WHEN array_length(parts.arr, 1) > 4
                    THEN array_to_string(parts.arr[4:array_length(parts.arr, 1)], ', ')
                    ELSE parts.arr[4] END
FROM parts
WHERE l.id = parts.id
  AND array_length(parts.arr, 1) >= 2;

-- ── B. Keep ledger address in sync when a party is edited ────────────────
CREATE OR REPLACE FUNCTION public.tg_party_sync_ledger_address()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ledger_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.address1 IS DISTINCT FROM OLD.address1
     OR NEW.address2 IS DISTINCT FROM OLD.address2
     OR NEW.address3 IS DISTINCT FROM OLD.address3
     OR NEW.address4 IS DISTINCT FROM OLD.address4 THEN
    UPDATE public.ledger l
    SET address1 = NULLIF(NEW.address1, ''),
        address2 = NULLIF(NEW.address2, ''),
        address3 = NULLIF(NEW.address3, ''),
        address4 = NULLIF(NEW.address4, '')
    WHERE l.id = NEW.ledger_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_party_sync_ledger_address ON public.party;
CREATE TRIGGER trg_party_sync_ledger_address
  AFTER UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.tg_party_sync_ledger_address();

COMMIT;
