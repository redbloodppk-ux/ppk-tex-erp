-- 100_sizing_job_auto_status.sql
--
-- Auto-managed status for sizing_job. The user no longer has to pick a
-- status or fill in dates manually on the New Sizing Job form. Instead:
--
--   * On creation                  → status = 'received'  (yarn handed to sizing vendor)
--   * When ANY pavu is assigned    → status = 'assigned'  (a beam is now on a loom)
--
-- The 'assigned' value already exists in sizing_job_status (see migration
-- 001), so this is purely a triggers + defaults change.

BEGIN;

-- 1. New rows default to 'received'. Existing data is untouched.
ALTER TABLE public.sizing_job
  ALTER COLUMN status SET DEFAULT 'received';

-- 2. Whenever a pavu_assign row is inserted (or updated to an active
--    status), bump the parent sizing_job to 'assigned' — but only if it
--    isn't already in a later stage (done / cancelled).
CREATE OR REPLACE FUNCTION public.fn_sizing_job_mark_assigned()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_job_id bigint;
BEGIN
  -- Only react to assignments that actually put a beam onto a loom.
  IF NEW.status NOT IN ('queued','mounted','running') THEN
    RETURN NEW;
  END IF;

  SELECT p.sizing_job_id INTO v_job_id
  FROM public.pavu p
  WHERE p.id = NEW.pavu_id;

  IF v_job_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.sizing_job
     SET status = 'assigned',
         updated_at = now()
   WHERE id = v_job_id
     AND status NOT IN ('assigned','done','cancelled');

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_pavu_assign_set_sizing_status ON public.pavu_assign;
CREATE TRIGGER trg_pavu_assign_set_sizing_status
  AFTER INSERT OR UPDATE ON public.pavu_assign
  FOR EACH ROW EXECUTE FUNCTION public.fn_sizing_job_mark_assigned();

COMMIT;
