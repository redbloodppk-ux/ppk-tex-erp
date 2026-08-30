-- ============================================================================
-- 278: PAN is inside the GSTIN. Stop asking anyone to type it.
--
-- PPK, 2026-08-30, having filled it in by hand on SHRI NITHYA: "look at how
-- i derive PAN from GST number so apply to all party".
--
-- A GSTIN is 15 characters and characters 3-12 ARE the PAN:
--
--   33 AAUFS6860N 1 Z A
--   ^^ state       ^ entity
--      ^^^^^^^^^^ PAN     ^ Z, fixed   ^ checksum
--
-- So for any party with a GSTIN the PAN is not a separate fact to collect,
-- it is already on file. 185 of 192 parties had a GSTIN and NONE had a PAN,
-- which mattered because section 206AA puts TDS at 20% for a party without
-- one and the quarterly return cannot be filed without it. Every one of
-- those 185 GSTINs is 15 characters with a well-formed PAN inside it, and
-- not one conflicts with an existing PAN, because there were none.
--
-- The remaining 7 have no GSTIN at all — unregistered parties — so there is
-- nothing to derive and they are left blank rather than guessed at.
--
-- The trigger fills PAN only when it is EMPTY. A hand-entered PAN is never
-- overwritten: if someone has deliberately corrected one, that correction
-- outranks the derivation, and a PAN that disagrees with its GSTIN is worth
-- a human look rather than a silent fix. The party form flags the mismatch
-- and offers the GSTIN's value as a one-click correction.
--
-- Verified after applying: 185 filled, 7 blank (all without GSTIN), 0
-- mismatches. Trigger tested three ways — derived when blank, hand-typed
-- value kept, NULL when there is no GSTIN — in a rolled-back transaction.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_pan_from_gstin(p_gstin text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_gstin IS NULL THEN NULL
    WHEN length(trim(p_gstin)) <> 15 THEN NULL
    WHEN substring(upper(trim(p_gstin)) FROM 3 FOR 10) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'
      THEN substring(upper(trim(p_gstin)) FROM 3 FOR 10)
    ELSE NULL
  END
$$;

COMMENT ON FUNCTION public.fn_pan_from_gstin(text) IS
  'Characters 3-12 of a GSTIN are the PAN. Returns NULL rather than a guess when the GSTIN is not 15 characters or those 10 do not match the PAN pattern. See migration 278.';

CREATE OR REPLACE FUNCTION public.fn_party_fill_pan_from_gstin()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(trim(NEW.pan), '') = '' THEN
    NEW.pan := public.fn_pan_from_gstin(NEW.gstin);
  ELSE
    NEW.pan := upper(trim(NEW.pan));
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_party_fill_pan_from_gstin ON public.party;
CREATE TRIGGER trg_party_fill_pan_from_gstin
  BEFORE INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_party_fill_pan_from_gstin();

-- Backfill. Only where PAN is empty and the GSTIN yields a valid one.
UPDATE public.party
SET pan = public.fn_pan_from_gstin(gstin)
WHERE coalesce(trim(pan), '') = ''
  AND public.fn_pan_from_gstin(gstin) IS NOT NULL;

COMMENT ON COLUMN public.party.pan IS
  'Permanent Account Number. Derived automatically from characters 3-12 of the GSTIN when left blank (migration 278); a hand-entered value is kept as typed and never overwritten. Needed for the quarterly TDS return, and its absence puts the deduction at 20% under section 206AA.';

-- Verify:
--   select count(*) filter (where pan is not null) as with_pan,
--          count(*) filter (where pan is null)     as without_pan
--   from party;
-- Expected: 185 with, 7 without (the 7 have no GSTIN).
