-- ============================================================================
-- 277: A beam is on one loom, and a loom holds one beam.
--
-- On 4 July 2026 beams 3323, 3324 and 3325 were each recorded onto the loom
-- one place along from where they belonged, then re-entered correctly. The
-- wrong rows were left behind with an end date of 7 July, and because
-- migration 241 sums every mount cycle, each stray row's metres were added
-- to a beam that was demonstrably on a different loom at the time. Beam 3324
-- came to read 1577.10 m off a 1080 m beam — 146%.
--
-- Seen from the loom's side the same rows say L-16 and L-17 each held two
-- beams at once. Both readings are impossible, and nothing in the database
-- objected.
--
-- PPK, 2026-08-30: leave the history, stop it recurring. So this guards new
-- writes only. The July rows stay exactly as they are.
--
-- "Live" means on the loom now: end_date IS NULL and status mounted/running.
-- A row that has ended does not block anything, which is what lets the swap
-- flow work — it closes the old row before inserting the new one. Queued
-- rows are plans, not mounts, and block nothing.
--
-- Verified before applying: no beam and no loom currently breaks either rule,
-- so no existing row becomes un-editable.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_pavu_assign_no_double_mount()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_beam  text;
  v_loom  text;
  v_other text;
BEGIN
  -- Only rows that actually put a beam on a loom are guarded.
  IF NEW.end_date IS NOT NULL OR NEW.status NOT IN ('mounted', 'running') THEN
    RETURN NEW;
  END IF;

  -- 1) Is this beam already on another loom?
  SELECT l.loom_code INTO v_other
  FROM public.pavu_assign a
  JOIN public.loom l ON l.id = a.loom_id
  WHERE a.pavu_id = NEW.pavu_id
    AND a.id IS DISTINCT FROM NEW.id
    AND a.end_date IS NULL
    AND a.status IN ('mounted', 'running')
  LIMIT 1;

  IF v_other IS NOT NULL THEN
    SELECT p.beam_no INTO v_beam FROM public.pavu p WHERE p.id = NEW.pavu_id;
    RAISE EXCEPTION
      'Beam % is already on loom %. Take it off there first — one beam cannot be on two looms.',
      COALESCE(v_beam, NEW.pavu_id::text), v_other
      USING ERRCODE = 'check_violation';
  END IF;

  -- 2) Does this loom already hold a beam?
  SELECT p.beam_no INTO v_beam
  FROM public.pavu_assign a
  JOIN public.pavu p ON p.id = a.pavu_id
  WHERE a.loom_id = NEW.loom_id
    AND a.id IS DISTINCT FROM NEW.id
    AND a.end_date IS NULL
    AND a.status IN ('mounted', 'running')
  LIMIT 1;

  IF v_beam IS NOT NULL THEN
    SELECT l.loom_code INTO v_loom FROM public.loom l WHERE l.id = NEW.loom_id;
    RAISE EXCEPTION
      'Loom % already has beam % on it. Remove or replace that beam first.',
      COALESCE(v_loom, NEW.loom_id::text), v_beam
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_pavu_assign_no_double_mount ON public.pavu_assign;
CREATE TRIGGER trg_pavu_assign_no_double_mount
  BEFORE INSERT OR UPDATE ON public.pavu_assign
  FOR EACH ROW EXECUTE FUNCTION public.fn_pavu_assign_no_double_mount();

COMMENT ON FUNCTION public.fn_pavu_assign_no_double_mount() IS
  'Refuses to put a beam on a loom while that beam is live elsewhere, or while that loom already holds a beam. Guards new writes only; the July 2026 overlaps are left as history. See migration 277.';
