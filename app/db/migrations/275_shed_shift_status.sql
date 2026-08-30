-- 275_shed_shift_status.sql
--
-- Makes two facts explicit that the wage calculation has been guessing:
--   1. whether a shift is part of the standard working week at all
--   2. whether a given shed actually ran in that shift
--
-- WHY
-- PPK, 2026-08-30, on the week of 24-30 Aug: "winder kamchi - 12 shift
-- running and 14 non running / winder maliga - 19 shift running and 4
-- [corrected to 7] non running ... you showing wrong again why?"
--
-- The screen said 8 of 20 for KAMACHI. Both are arithmetically right; they
-- disagree about the DENOMINATOR. The mill could not run on the nights of
-- 24, 25 and 26 Aug for want of weavers, and those three shifts are marked
-- is_working = false. The allocator drops a non-working shift out of the
-- week entirely, so:
--
--   week as recorded : 10 working slots x 2 sheds = 20 boxes @ Rs 220.00
--   week as PPK runs : 13 shifts       x 2 sheds = 26 boxes @ Rs 169.23
--
-- Closing the mill for three nights therefore RAISED the box rate and cost
-- the winders nothing, when in reality nothing was wound on those nights.
--
-- THE CONFUSION, AS ALWAYS, IS ONE FIELD MEANING TWO THINGS
-- `is_working = false` currently covers both:
--   * Sunday night - never a shift. Outside the week. 13 of 13 Sunday
--     nights since June are non-working; the mill simply does not run one.
--   * A shift that SHOULD have run and did not - no weavers, power cut,
--     maintenance, festival. Part of the week. Pays nobody.
-- The first must leave the denominator; the second must stay in it. One
-- boolean cannot say both, which is the same defect behind every wage bug
-- found this month (see migrations 261/263, 264, 266).
--
-- counts_in_week answers only the first question: is this shift part of
-- the mill's normal week? is_working keeps answering the second: did it
-- run? Per PPK 2026-08-30, ALL four closure reasons (no weavers, power
-- cut, maintenance, national holiday) stay in the week and pay nothing.
--
-- SHED_SHIFT_STATUS
-- Even within a working shift, "did shed 4 run?" is today inferred from
-- whether some weaver row on shed 4 shows a weaver who worked. That
-- inference has been hand-corrected four times in a fortnight (migrations
-- 263, 265, 266, 269). This table lets a supervisor state it outright.
--
-- A row exists only when someone actively ticks, exactly like winder_cover:
-- its presence IS the confirmation. No row means nobody said, and the
-- allocator falls back to the weaver-row inference unchanged - so every
-- week already settled computes exactly as it does today.
--
-- NOTE ON DATES: this migration only records facts. The behaviour change
-- is gated in code at 2026-08-24, the Monday of the first unsettled week,
-- so the settled weeks through 23 Aug do not move. See
-- SHED_SLOT_DENOMINATOR_FROM in lib/wages/winder-allocation.ts.

BEGIN;

-- 1) Is this shift part of the mill's standard week? ------------------

ALTER TABLE public.attendance_day
  ADD COLUMN IF NOT EXISTS counts_in_week boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.attendance_day.counts_in_week IS
  'Is this shift part of the mill''s standard working week? Distinct from '
  'is_working, which says whether it actually ran. A shift that should '
  'have run but did not (no weavers, power cut, maintenance, festival) is '
  'counts_in_week = true, is_working = false: it stays in the wage '
  'denominator and pays nobody. Sunday night is counts_in_week = false - '
  'the mill never runs one, so it is outside the week entirely. See '
  'migration 275.';

-- Sunday night is the only shift the mill does not schedule. Every one of
-- the 13 Sunday nights on record since June is non-working, and none has
-- ever been worked. Set from the calendar rather than from is_working, so
-- a Sunday night someone DID run would still read as outside the standard
-- week and would not silently change everybody's box rate.
UPDATE public.attendance_day
SET counts_in_week = false
WHERE shift = 'night'
  AND EXTRACT(ISODOW FROM attendance_date) = 7;

-- 2) Did this shed run in this shift? ---------------------------------

CREATE TABLE IF NOT EXISTS public.shed_shift_status (
  id                bigserial PRIMARY KEY,
  attendance_day_id bigint  NOT NULL REFERENCES public.attendance_day(id) ON DELETE CASCADE,
  shed_no           text    NOT NULL,
  is_running        boolean NOT NULL,
  -- Free text, not an enum. The reason a shed stopped is a note for the
  -- supervisor's memory; nothing in the wage maths reads it, and PPK has
  -- confirmed every closure reason is paid the same way. An enum here
  -- would invite exactly the "one value, several meanings" trap this
  -- migration exists to undo.
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,

  -- One answer per shed per shift. Re-tapping corrects, never duplicates.
  CONSTRAINT shed_shift_status_unique UNIQUE (attendance_day_id, shed_no)
);

CREATE INDEX IF NOT EXISTS idx_shed_shift_status_day
  ON public.shed_shift_status(attendance_day_id);

COMMENT ON TABLE public.shed_shift_status IS
  'Whether one shed ran in one shift, stated by a supervisor rather than '
  'inferred from weaver attendance rows. A row exists only where someone '
  'confirmed it; absence of a row means the wage calculation falls back '
  'to deriveWeaverGapSlots as before. See migration 275.';

CREATE OR REPLACE FUNCTION public.fn_shed_shift_status_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$$;

DROP TRIGGER IF EXISTS trg_shed_shift_status_touch ON public.shed_shift_status;
CREATE TRIGGER trg_shed_shift_status_touch
  BEFORE UPDATE ON public.shed_shift_status
  FOR EACH ROW EXECUTE FUNCTION public.fn_shed_shift_status_touch_updated_at();

-- Same access shape as winder_cover and attendance_entry.
ALTER TABLE public.shed_shift_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_shed_shift_status_read ON public.shed_shift_status;
CREATE POLICY p_shed_shift_status_read ON public.shed_shift_status
  FOR SELECT USING (
    public.current_user_role() = ANY (ARRAY[
      'owner'::user_role, 'auditor'::user_role,
      'mill_manager'::user_role, 'accounts'::user_role
    ])
  );

DROP POLICY IF EXISTS p_shed_shift_status_write ON public.shed_shift_status;
CREATE POLICY p_shed_shift_status_write ON public.shed_shift_status
  FOR ALL USING (
    public.current_user_role() = ANY (ARRAY['owner'::user_role, 'mill_manager'::user_role])
  );

COMMIT;

-- Verify: the week of 24-30 Aug 2026 should now show 13 shifts counting in
-- the week (14 rows less Sunday night), of which 10 are is_working.
--
--   SELECT count(*) FILTER (WHERE counts_in_week)                  AS in_week,
--          count(*) FILTER (WHERE counts_in_week AND is_working)   AS ran
--   FROM attendance_day
--   WHERE attendance_date BETWEEN '2026-08-24' AND '2026-08-30';
--   -> in_week 13, ran 10
