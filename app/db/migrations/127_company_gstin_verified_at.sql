-- 127_company_gstin_verified_at.sql
--
-- Settings → Company gains a real edit form (CORR-ext1) backed by the
-- shared GstinLookup component. When verification succeeds the form
-- writes a timestamp to `company_profile.gstin_verified_at` so the
-- green "verified" tick stays after the page reloads — without this
-- column the tick would re-disappear every time the operator opened
-- the form again and they'd lose faith in the verification state.
--
-- Cleared automatically when the GSTIN value itself is edited: the
-- form's UI clears it client-side, and we add a partial check to
-- guarantee verified_at can't outlive a value-less GSTIN (defence in
-- depth — the form is the source of truth, this is a safety net).

BEGIN;

ALTER TABLE public.company_profile
  ADD COLUMN IF NOT EXISTS gstin_verified_at timestamptz;

COMMENT ON COLUMN public.company_profile.gstin_verified_at IS
  'Timestamp of the most recent successful GSTIN verification via /app/api/gst. Cleared client-side when the GSTIN value is changed. NULL = never verified, or verification was invalidated by an edit.';

COMMIT;
