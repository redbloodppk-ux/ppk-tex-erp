-- 099_gstin_verified_at.sql
--
-- Track which GSTINs have been verified against the live GST portal.
-- A non-null `gstin_verified_at` timestamp means the GSTIN was confirmed
-- by the GST API (either live or mock); the UI shows a green tick next
-- to the party / customer / ledger name.
--
-- Verification is invalidated automatically whenever the GSTIN field is
-- changed or cleared — re-verification is needed to get the tick back.

BEGIN;

-- 1. New column on every table that stores a party-style GSTIN.
ALTER TABLE public.party
  ADD COLUMN IF NOT EXISTS gstin_verified_at timestamptz;
ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS gstin_verified_at timestamptz;
ALTER TABLE public.customer
  ADD COLUMN IF NOT EXISTS gstin_verified_at timestamptz;

COMMENT ON COLUMN public.party.gstin_verified_at IS
  'Timestamp the GSTIN was successfully verified against the GST portal. NULL means unverified. Cleared automatically when gstin changes.';
COMMENT ON COLUMN public.ledger.gstin_verified_at IS
  'Same as party.gstin_verified_at — verification flag for the ledger''s GSTIN.';
COMMENT ON COLUMN public.customer.gstin_verified_at IS
  'Same as party.gstin_verified_at — verification flag for the customer''s GSTIN.';

-- 2. Trigger function: clear gstin_verified_at when the GSTIN itself
--    changes (or is cleared). Re-verification is required afterwards.
CREATE OR REPLACE FUNCTION public.fn_invalidate_gstin_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- INSERT path: nothing to compare against; trust whatever the caller sent.
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- UPDATE path: if the GSTIN value changed (including NULL <-> value),
  -- reset the verification flag UNLESS the caller is explicitly setting
  -- a new timestamp at the same time (re-verify + save in one go).
  IF NEW.gstin IS DISTINCT FROM OLD.gstin THEN
    IF NEW.gstin_verified_at IS NOT DISTINCT FROM OLD.gstin_verified_at THEN
      NEW.gstin_verified_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_party_invalidate_gstin_verification    ON public.party;
DROP TRIGGER IF EXISTS trg_ledger_invalidate_gstin_verification   ON public.ledger;
DROP TRIGGER IF EXISTS trg_customer_invalidate_gstin_verification ON public.customer;

CREATE TRIGGER trg_party_invalidate_gstin_verification
  BEFORE INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_gstin_verification();

CREATE TRIGGER trg_ledger_invalidate_gstin_verification
  BEFORE INSERT OR UPDATE ON public.ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_gstin_verification();

CREATE TRIGGER trg_customer_invalidate_gstin_verification
  BEFORE INSERT OR UPDATE ON public.customer
  FOR EACH ROW EXECUTE FUNCTION public.fn_invalidate_gstin_verification();

COMMIT;
