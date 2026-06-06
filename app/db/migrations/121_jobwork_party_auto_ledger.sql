-- 121_jobwork_party_auto_ledger.sql
--
-- Every new jobwork_party row gets a matching ledger row created and
-- linked back via jobwork_party.ledger_id. Type routing:
--
--   jobwork_party.kind = 'jobwork'   → ledger.type = 'JOB WORK(VENDOR)'
--   jobwork_party.kind = 'outsource' → ledger.type = 'WEAVING(VENDOR)'
--
-- The ledger row is filled from the jobwork_party's contact data
-- (name, billing_address → address1, phone, email, gstin). When the
-- jobwork_party is updated later we leave the ledger alone — that
-- keeps accounting changes intentional and avoids surprise rewrites.
--
-- Existing jobwork_party rows without a ledger_id are backfilled at
-- the end of the migration so the dropdowns / cascades that key off
-- ledger_id work uniformly going forward.

BEGIN;

ALTER TABLE public.jobwork_party
  ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id);

CREATE OR REPLACE FUNCTION public.fn_jobwork_party_create_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_type_name text;
  v_type_id   bigint;
  v_group_id  bigint;
  v_ledger_id bigint;
BEGIN
  -- Nothing to do if a ledger was already linked at insert time
  -- (e.g. the application or a future migration set it directly).
  IF NEW.ledger_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_type_name := CASE WHEN NEW.kind = 'outsource'
                      THEN 'WEAVING(VENDOR)'
                      ELSE 'JOB WORK(VENDOR)'
                 END;

  SELECT id INTO v_type_id FROM public.ledger_type WHERE name = v_type_name LIMIT 1;

  -- If the type row doesn't exist yet we can't link; just leave
  -- ledger_id null. Operator can re-run the backfill later.
  IF v_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pick whichever group is already in use for this ledger type;
  -- falls back to NULL if no existing rows of this type yet.
  SELECT group_id INTO v_group_id
  FROM public.ledger
  WHERE type_id = v_type_id AND group_id IS NOT NULL
  LIMIT 1;

  INSERT INTO public.ledger (
    name, type_id, group_id,
    address1, phone, email, gstin,
    active
  ) VALUES (
    NEW.name, v_type_id, v_group_id,
    NEW.billing_address, NEW.phone, NEW.email, NEW.gstin,
    true
  ) RETURNING id INTO v_ledger_id;

  UPDATE public.jobwork_party SET ledger_id = v_ledger_id WHERE id = NEW.id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jobwork_party_create_ledger ON public.jobwork_party;
CREATE TRIGGER trg_jobwork_party_create_ledger
AFTER INSERT ON public.jobwork_party
FOR EACH ROW
EXECUTE FUNCTION public.fn_jobwork_party_create_ledger();

-- Backfill existing rows. Resolves the type per-row so jobwork and
-- outsource entries go to the right ledger type.
DO $$
DECLARE
  rec RECORD;
  v_type_name text;
  v_type_id   bigint;
  v_group_id  bigint;
  v_ledger_id bigint;
BEGIN
  FOR rec IN SELECT * FROM public.jobwork_party WHERE ledger_id IS NULL LOOP
    v_type_name := CASE WHEN rec.kind = 'outsource'
                        THEN 'WEAVING(VENDOR)'
                        ELSE 'JOB WORK(VENDOR)'
                   END;

    SELECT id INTO v_type_id FROM public.ledger_type WHERE name = v_type_name LIMIT 1;
    IF v_type_id IS NULL THEN
      CONTINUE;
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
      rec.name, v_type_id, v_group_id,
      rec.billing_address, rec.phone, rec.email, rec.gstin,
      true
    ) RETURNING id INTO v_ledger_id;

    UPDATE public.jobwork_party SET ledger_id = v_ledger_id WHERE id = rec.id;
  END LOOP;
END $$;

COMMENT ON COLUMN public.jobwork_party.ledger_id IS
  'Auto-linked ledger row (created by trg_jobwork_party_create_ledger). type_id routes by kind: jobwork → JOB WORK(VENDOR), outsource → WEAVING(VENDOR).';

COMMIT;
