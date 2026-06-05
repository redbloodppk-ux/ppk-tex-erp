-- 101_gstin_verification_sync.sql
--
-- Make `gstin_verified_at` shared across party / customer / ledger.
-- Once a GSTIN is verified anywhere, the green tick should appear on
-- every row that holds the same GSTIN (party form, customer dropdown,
-- ledger list, etc.).
--
-- Two-way sync:
--   * PULL (BEFORE INSERT/UPDATE): when a row's gstin_verified_at is
--     NULL but gstin is set, look for any other row with the same
--     gstin that already carries a verified_at and copy it in.
--   * PUSH (AFTER INSERT/UPDATE):  when a row's gstin_verified_at
--     becomes non-NULL, propagate that timestamp to every other row
--     across the three tables that shares the same gstin.
--
-- Recursion is naturally bounded because every UPDATE we issue
-- short-circuits with `IS DISTINCT FROM` once the destination row is
-- already in sync with the source value.

BEGIN;

-- ── 1. Backfill: any GSTIN that's verified somewhere is verified everywhere ──
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT gstin, max(when_) AS verified_at
      FROM (
        SELECT gstin, gstin_verified_at AS when_ FROM public.party
         WHERE gstin IS NOT NULL AND gstin <> '' AND gstin_verified_at IS NOT NULL
        UNION ALL
        SELECT gstin, gstin_verified_at FROM public.customer
         WHERE gstin IS NOT NULL AND gstin <> '' AND gstin_verified_at IS NOT NULL
        UNION ALL
        SELECT gstin, gstin_verified_at FROM public.ledger
         WHERE gstin IS NOT NULL AND gstin <> '' AND gstin_verified_at IS NOT NULL
      ) t
     GROUP BY gstin
  LOOP
    UPDATE public.party
       SET gstin_verified_at = r.verified_at
     WHERE gstin = r.gstin
       AND (gstin_verified_at IS NULL OR gstin_verified_at < r.verified_at);
    UPDATE public.customer
       SET gstin_verified_at = r.verified_at
     WHERE gstin = r.gstin
       AND (gstin_verified_at IS NULL OR gstin_verified_at < r.verified_at);
    UPDATE public.ledger
       SET gstin_verified_at = r.verified_at
     WHERE gstin = r.gstin
       AND (gstin_verified_at IS NULL OR gstin_verified_at < r.verified_at);
  END LOOP;
END $$;

-- ── 2. PULL function: fill our own gstin_verified_at from siblings ─────────
-- Runs BEFORE INSERT/UPDATE. Only acts when the row's own
-- gstin_verified_at is NULL but it has a gstin — typically a fresh
-- INSERT, or right after the invalidation trigger (099) cleared the
-- flag because gstin changed to a value some other row has verified.
CREATE OR REPLACE FUNCTION public.fn_pull_gstin_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_when timestamptz;
BEGIN
  IF NEW.gstin IS NULL OR NEW.gstin = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.gstin_verified_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT max(t.v) INTO v_when
    FROM (
      SELECT gstin_verified_at AS v FROM public.party
        WHERE gstin = NEW.gstin AND gstin_verified_at IS NOT NULL
      UNION ALL
      SELECT gstin_verified_at FROM public.customer
        WHERE gstin = NEW.gstin AND gstin_verified_at IS NOT NULL
      UNION ALL
      SELECT gstin_verified_at FROM public.ledger
        WHERE gstin = NEW.gstin AND gstin_verified_at IS NOT NULL
    ) t;

  IF v_when IS NOT NULL THEN
    NEW.gstin_verified_at := v_when;
  END IF;
  RETURN NEW;
END
$$;

-- ── 3. PUSH function: broadcast our verified_at to siblings ────────────────
-- Runs AFTER INSERT/UPDATE. Only acts when gstin_verified_at is
-- non-NULL AND it actually changed (so re-saving an already-synced row
-- is a no-op). Updates the other two tables, skipping rows that
-- already carry the same value to avoid trigger recursion.
CREATE OR REPLACE FUNCTION public.fn_push_gstin_verification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.gstin IS NULL OR NEW.gstin = '' THEN
    RETURN NEW;
  END IF;
  IF NEW.gstin_verified_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.gstin_verified_at IS NOT DISTINCT FROM NEW.gstin_verified_at THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME <> 'party' THEN
    UPDATE public.party
       SET gstin_verified_at = NEW.gstin_verified_at
     WHERE gstin = NEW.gstin
       AND gstin_verified_at IS DISTINCT FROM NEW.gstin_verified_at;
  END IF;

  IF TG_TABLE_NAME <> 'customer' THEN
    UPDATE public.customer
       SET gstin_verified_at = NEW.gstin_verified_at
     WHERE gstin = NEW.gstin
       AND gstin_verified_at IS DISTINCT FROM NEW.gstin_verified_at;
  END IF;

  IF TG_TABLE_NAME <> 'ledger' THEN
    UPDATE public.ledger
       SET gstin_verified_at = NEW.gstin_verified_at
     WHERE gstin = NEW.gstin
       AND gstin_verified_at IS DISTINCT FROM NEW.gstin_verified_at;
  END IF;

  RETURN NEW;
END
$$;

-- ── 4. Wire the triggers ──────────────────────────────────────────────────
-- Naming uses _zpull / _zpush so they sort AFTER the existing
-- _invalidate_gstin_verification trigger (which clears the flag when
-- gstin changes) and AFTER the rest of alphabetical triggers, giving
-- a predictable fire order:
--   invalidate (BEFORE)  →  zpull (BEFORE)  →  ... row write ...  →  zpush (AFTER)
DROP TRIGGER IF EXISTS trg_party_zpull_gstin_verification    ON public.party;
DROP TRIGGER IF EXISTS trg_customer_zpull_gstin_verification ON public.customer;
DROP TRIGGER IF EXISTS trg_ledger_zpull_gstin_verification   ON public.ledger;

CREATE TRIGGER trg_party_zpull_gstin_verification
  BEFORE INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_pull_gstin_verification();

CREATE TRIGGER trg_customer_zpull_gstin_verification
  BEFORE INSERT OR UPDATE ON public.customer
  FOR EACH ROW EXECUTE FUNCTION public.fn_pull_gstin_verification();

CREATE TRIGGER trg_ledger_zpull_gstin_verification
  BEFORE INSERT OR UPDATE ON public.ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_pull_gstin_verification();

DROP TRIGGER IF EXISTS trg_party_zpush_gstin_verification    ON public.party;
DROP TRIGGER IF EXISTS trg_customer_zpush_gstin_verification ON public.customer;
DROP TRIGGER IF EXISTS trg_ledger_zpush_gstin_verification   ON public.ledger;

CREATE TRIGGER trg_party_zpush_gstin_verification
  AFTER INSERT OR UPDATE ON public.party
  FOR EACH ROW EXECUTE FUNCTION public.fn_push_gstin_verification();

CREATE TRIGGER trg_customer_zpush_gstin_verification
  AFTER INSERT OR UPDATE ON public.customer
  FOR EACH ROW EXECUTE FUNCTION public.fn_push_gstin_verification();

CREATE TRIGGER trg_ledger_zpush_gstin_verification
  AFTER INSERT OR UPDATE ON public.ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_push_gstin_verification();

COMMIT;
