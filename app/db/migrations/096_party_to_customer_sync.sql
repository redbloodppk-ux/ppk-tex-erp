-- 096_party_to_customer_sync.sql
-- When a party is tagged as Customer or Rental, auto-create a matching
-- customer row sharing the same ledger_id. The customer table remains
-- the FK target for invoice.customer_id; the party table becomes the
-- user-facing source for customer dropdowns.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_party_to_customer_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_is_customer_kind boolean;
BEGIN
  IF NEW.ledger_id IS NULL THEN RETURN NEW; END IF;

  SELECT EXISTS(
    SELECT 1
    FROM public.party_type_master pt
    WHERE pt.id = ANY(NEW.party_type_ids)
      AND pt.name IN ('Customer','Rental')
  ) INTO v_is_customer_kind;

  IF NOT v_is_customer_kind THEN RETURN NEW; END IF;

  IF EXISTS(SELECT 1 FROM public.customer WHERE ledger_id = NEW.ledger_id AND status = 'active') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.customer (name, gstin, billing_address, state, state_code, city, pincode, ledger_id, phone, email, status)
  VALUES (NEW.name, NEW.gstin, NEW.billing_address, NEW.state, NEW.state_code, NEW.city, NEW.pincode, NEW.ledger_id, NEW.phone, NEW.email, 'active');

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_party_to_customer_sync ON public.party;
CREATE TRIGGER trg_party_to_customer_sync
  AFTER INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_party_to_customer_sync();

COMMIT;
