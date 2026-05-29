-- 058_customer_mill_link_ledger.sql
--
-- Bookkeeping link: every customer becomes a CUSTOMER + SUNDRY DEBTORS
-- ledger; every mill becomes a SUPPLIER + SUNDRY CREDITORS ledger. The
-- operational customer / mill tables stay - they keep credit limits,
-- payment terms, billing address etc - but each row now points at its
-- matching ledger row for reporting and accounting.
--
-- Behaviour:
--   - backfill existing rows by name match, create missing ledger rows
--   - INSERT trigger on customer/mill auto-creates the matching ledger
--     row whenever a new operational row is added without one

BEGIN;

ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

ALTER TABLE public.mill
  ADD COLUMN IF NOT EXISTS ledger_id bigint REFERENCES public.ledger(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customer_ledger_id ON public.customer(ledger_id);
CREATE INDEX IF NOT EXISTS idx_mill_ledger_id     ON public.mill(ledger_id);

-- Backfill customers via name match against CUSTOMER + SUNDRY DEBTORS.
WITH ids AS (
  SELECT (SELECT id FROM public.ledger_type  WHERE name = 'CUSTOMER')        AS type_id,
         (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY DEBTORS')  AS group_id
)
UPDATE public.customer c
SET    ledger_id = l.id
FROM   public.ledger l, ids
WHERE  c.ledger_id IS NULL
  AND  l.name = c.name
  AND  l.type_id  = ids.type_id
  AND  l.group_id = ids.group_id;

WITH ids AS (
  SELECT (SELECT id FROM public.ledger_type  WHERE name = 'CUSTOMER')       AS type_id,
         (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY DEBTORS') AS group_id
),
ins AS (
  INSERT INTO public.ledger (name, type_id, group_id, address1, phone, email, gstin)
  SELECT c.name, ids.type_id, ids.group_id, c.billing_address, c.phone, c.email, c.gstin
  FROM   public.customer c, ids
  WHERE  c.ledger_id IS NULL
  RETURNING id, name
)
UPDATE public.customer c
SET    ledger_id = ins.id
FROM   ins
WHERE  c.ledger_id IS NULL AND c.name = ins.name;

-- Backfill mills via name match against SUPPLIER + SUNDRY CREDITORS.
WITH ids AS (
  SELECT (SELECT id FROM public.ledger_type  WHERE name = 'SUPPLIER')         AS type_id,
         (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS') AS group_id
)
UPDATE public.mill m
SET    ledger_id = l.id
FROM   public.ledger l, ids
WHERE  m.ledger_id IS NULL
  AND  l.name = m.name
  AND  l.type_id  = ids.type_id
  AND  l.group_id = ids.group_id;

WITH ids AS (
  SELECT (SELECT id FROM public.ledger_type  WHERE name = 'SUPPLIER')         AS type_id,
         (SELECT id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS') AS group_id
),
ins AS (
  INSERT INTO public.ledger (name, type_id, group_id, address1, phone, email, gstin)
  SELECT m.name, ids.type_id, ids.group_id, m.address, m.phone, m.email, m.gstin
  FROM   public.mill m, ids
  WHERE  m.ledger_id IS NULL
  RETURNING id, name
)
UPDATE public.mill m
SET    ledger_id = ins.id
FROM   ins
WHERE  m.ledger_id IS NULL AND m.name = ins.name;

-- INSERT triggers on customer + mill keep the link automatic.
CREATE OR REPLACE FUNCTION public.tg_customer_link_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type_id  bigint;
  v_group_id bigint;
  v_ledger_id bigint;
BEGIN
  IF NEW.ledger_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_type_id  FROM public.ledger_type  WHERE name = 'CUSTOMER';
  SELECT id INTO v_group_id FROM public.ledger_group WHERE name = 'SUNDRY DEBTORS';
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

DROP TRIGGER IF EXISTS trg_customer_link_ledger ON public.customer;
CREATE TRIGGER trg_customer_link_ledger
  BEFORE INSERT ON public.customer
  FOR EACH ROW EXECUTE FUNCTION public.tg_customer_link_ledger();

CREATE OR REPLACE FUNCTION public.tg_mill_link_ledger()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_type_id  bigint;
  v_group_id bigint;
  v_ledger_id bigint;
BEGIN
  IF NEW.ledger_id IS NOT NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_type_id  FROM public.ledger_type  WHERE name = 'SUPPLIER';
  SELECT id INTO v_group_id FROM public.ledger_group WHERE name = 'SUNDRY CREDITORS';
  IF v_type_id IS NULL OR v_group_id IS NULL THEN RETURN NEW; END IF;

  SELECT id INTO v_ledger_id
  FROM   public.ledger
  WHERE  name = NEW.name AND type_id = v_type_id AND group_id = v_group_id
  LIMIT  1;

  IF v_ledger_id IS NULL THEN
    INSERT INTO public.ledger (name, type_id, group_id, address1, phone, email, gstin)
    VALUES (NEW.name, v_type_id, v_group_id, NEW.address, NEW.phone, NEW.email, NEW.gstin)
    RETURNING id INTO v_ledger_id;
  END IF;

  NEW.ledger_id := v_ledger_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_mill_link_ledger ON public.mill;
CREATE TRIGGER trg_mill_link_ledger
  BEFORE INSERT ON public.mill
  FOR EACH ROW EXECUTE FUNCTION public.tg_mill_link_ledger();

COMMIT;
