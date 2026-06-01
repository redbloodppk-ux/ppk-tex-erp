-- 072_party_auto_link_ledger.sql
--
-- Auto-create a ledger row for every party so the accounting side stays
-- in sync — same pattern customer + mill already use (migration 058).
--
--   - party_type_master gains ledger_type_id + ledger_group_id columns
--     so each type is mapped to the right accounting bucket.
--   - party gains ledger_id (nullable FK to ledger).
--   - A BEFORE INSERT trigger on party finds or creates the matching
--     ledger row and stamps party.ledger_id.

BEGIN;

ALTER TABLE public.party_type_master
  ADD COLUMN IF NOT EXISTS ledger_type_id  bigint REFERENCES public.ledger_type(id)  ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ledger_group_id bigint REFERENCES public.ledger_group(id) ON DELETE SET NULL;

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Customer'             AND lt.name = 'CUSTOMER'         AND lg.name = 'SUNDRY DEBTORS';

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Mill / Yarn Supplier' AND lt.name = 'SUPPLIER'         AND lg.name = 'SUNDRY CREDITORS';

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Jobwork Party'        AND lt.name = 'WEAVING(VENDOR)'  AND lg.name = 'SUNDRY CREDITORS';

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Sizing Party'         AND lt.name = 'SIZING(VENDOR)'   AND lg.name = 'SUNDRY CREDITORS';

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Outsource Weaver'     AND lt.name = 'WEAVING(VENDOR)'  AND lg.name = 'SUNDRY CREDITORS';

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Bobbin Supplier'      AND lt.name = 'SUPPLIER'         AND lg.name = 'SUNDRY CREDITORS';

UPDATE public.party_type_master pt SET ledger_type_id = lt.id, ledger_group_id = lg.id
FROM public.ledger_type lt, public.ledger_group lg
WHERE pt.name = 'Broker / Agent'       AND lt.name = 'AGENT'            AND lg.name = 'SUNDRY CREDITORS';

ALTER TABLE public.party
  ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_party_ledger_id ON public.party(ledger_id);

CREATE OR REPLACE FUNCTION public.tg_party_link_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type_id   bigint;
  v_group_id  bigint;
  v_ledger_id bigint;
BEGIN
  IF NEW.ledger_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.party_type_id IS NULL THEN RETURN NEW; END IF;

  SELECT ledger_type_id, ledger_group_id
    INTO v_type_id, v_group_id
  FROM public.party_type_master
  WHERE id = NEW.party_type_id;

  IF v_type_id IS NULL OR v_group_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_ledger_id
  FROM   public.ledger
  WHERE  name = NEW.name AND type_id = v_type_id AND group_id = v_group_id
  LIMIT  1;

  IF v_ledger_id IS NULL THEN
    INSERT INTO public.ledger (name, type_id, group_id, address1, phone, email, gstin)
    VALUES (NEW.name, v_type_id, v_group_id, NEW.billing_address, NEW.phone, NEW.email, NEW.gstin)
    RETURNING id INTO v_ledger_id;
  END IF;

  NEW.ledger_id := v_ledger_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_party_link_ledger ON public.party;
CREATE TRIGGER trg_party_link_ledger
  BEFORE INSERT ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.tg_party_link_ledger();

COMMIT;
