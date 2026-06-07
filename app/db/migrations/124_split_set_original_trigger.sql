-- 124_split_set_original_trigger.sql
--
-- The shared trigger function `fn_set_original_on_insert()` referenced
-- columns from three tables (jobwork_warp_beam, jobwork_weft_bag,
-- bobbin) inside if/elsif branches dispatched on TG_TABLE_NAME. That
-- pattern looks safe but is NOT — PL/pgSQL resolves every NEW.<field>
-- reference against the actual triggering row's type at function
-- entry, regardless of whether the branch will run. Inserting into
-- jobwork_warp_beam therefore raised:
--
--   record "new" has no field "original_kg"
--
-- because the weft-bag branch reaches NEW.original_kg, which the
-- warp-beam row doesn't have.
--
-- Fix: split into one function per table, each referencing only the
-- columns that exist on its own row. Triggers are repointed at the
-- new per-table functions.

BEGIN;

-- ── Per-table functions ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_original_warp_beam()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_metres IS NULL THEN
    NEW.original_metres := NEW.total_metres;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_set_original_weft_bag()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_kg IS NULL THEN
    NEW.original_kg := NEW.total_kg;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.fn_set_original_bobbin()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_quantity IS NULL THEN
    NEW.original_quantity := NEW.quantity;
  END IF;
  RETURN NEW;
END $$;

-- ── Repoint triggers at the per-table functions ───────────────────
DROP TRIGGER IF EXISTS tr_jwb_set_original   ON public.jobwork_warp_beam;
CREATE TRIGGER tr_jwb_set_original
  BEFORE INSERT ON public.jobwork_warp_beam
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_original_warp_beam();

DROP TRIGGER IF EXISTS tr_jwbag_set_original ON public.jobwork_weft_bag;
CREATE TRIGGER tr_jwbag_set_original
  BEFORE INSERT ON public.jobwork_weft_bag
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_original_weft_bag();

-- bobbin's trigger may or may not be present depending on migration
-- history; we drop+recreate either way.
DROP TRIGGER IF EXISTS tr_bobbin_set_original ON public.bobbin;
CREATE TRIGGER tr_bobbin_set_original
  BEFORE INSERT ON public.bobbin
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_original_bobbin();

-- Keep the old combined function around for any callers we may have
-- missed, but make its body a no-op so it can't fail again.
CREATE OR REPLACE FUNCTION public.fn_set_original_on_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- No-op shim. Real work happens in the per-table functions
  -- (fn_set_original_warp_beam / fn_set_original_weft_bag /
  -- fn_set_original_bobbin) installed in migration 124.
  RETURN NEW;
END $$;

COMMIT;
