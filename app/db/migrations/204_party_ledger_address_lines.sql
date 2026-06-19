-- 204_party_ledger_address_lines.sql
--
-- Bug fix: when a new party auto-creates its linked ledger (trigger added
-- in migration 072), the whole postal address was dumped into
-- ledger.address1 only — it inserted NEW.billing_address (the joined,
-- single-line address) into address1 and never touched address2/3/4.
-- That trigger predates the structured address1..4 columns, so every
-- party-created ledger ended up with the full address crammed into
-- line 1 and lines 2-4 empty (e.g. LED-0206 "G T M FABRICS").
--
-- This migration:
--   1. Rewrites tg_party_link_ledger() to copy the four structured
--      address lines (party.address1..4) into the new ledger row,
--      falling back to billing_address for line 1 when the structured
--      lines are empty (legacy CSV imports).
--   2. Backfills existing party-linked ledgers that lost the split —
--      i.e. the party has multiple structured lines but the ledger has
--      nothing in address2/3/4.

BEGIN;

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
    INSERT INTO public.ledger
      (name, type_id, group_id, address1, address2, address3, address4, phone, email, gstin)
    VALUES
      (NEW.name, v_type_id, v_group_id,
       COALESCE(NULLIF(NEW.address1, ''), NULLIF(NEW.billing_address, '')),
       NULLIF(NEW.address2, ''),
       NULLIF(NEW.address3, ''),
       NULLIF(NEW.address4, ''),
       NEW.phone, NEW.email, NEW.gstin)
    RETURNING id INTO v_ledger_id;
  END IF;

  NEW.ledger_id := v_ledger_id;
  RETURN NEW;
END $$;

-- Backfill: party-linked ledgers that lost the structured split. Only
-- touch ledgers where the party genuinely has lines 2-4 but the ledger
-- has none, so single-line and manually-edited ledgers are left alone.
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

COMMIT;
