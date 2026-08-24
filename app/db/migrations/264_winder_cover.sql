-- 264_winder_cover.sql
--
-- Records what actually happened to an absent winder's sheds, so wage
-- allocation stops INFERRING it from the auto-filled shed list.
--
-- WHY
-- When a winder is absent, her shed-slot money moves to whoever covered
-- that shed. Until now "who covered" was read off attendance_entry.shed_nos
-- of any present winder. But the attendance screen pre-fills shed_nos from
-- employee.default_sheds (attendance/mark/page.tsx), so that field records
-- what was EXPECTED, not what happened. Two real cases:
--
--   Mon 06-Jul morning  MALIGA absent. KAMACHI's card read [1,3,4] - shed 4
--                       added by hand, outside her own [1,3]. Real cover,
--                       correctly paid.
--   Fri 24 + Sat 25-Jul PACHAIYAMAAL absent on shed 4. MALIGA's card read
--                       [2,4] - her default, nobody ticked anything. The
--                       system paid her Rs 366.67 for cover it had merely
--                       assumed.
--
-- Same root cause as the two bugs fixed earlier today (migrations 261/263
-- and commit ad24807): a default silently standing in for a fact.
--
-- THE RECORD
-- One row per (shift, absent winder, shed). A row exists ONLY when the
-- supervisor actively taps, so its presence IS the confirmation - there is
-- no separate "confirmed" flag to fall out of sync. No row means nobody
-- looked, and allocation falls back to the old inference unchanged, so
-- every week before this migration computes exactly as it does today.
--
-- `outcome` is spelled out rather than encoded in a NULL. Every money bug
-- found on 2026-08-23 came from one value quietly meaning several things
-- (attendance `none` meaning not-scheduled, not-yet-marked AND gone-from-
-- the-job). This column reads as a sentence:
--   'covered'      someone else wound the shed - covered_by_employee_id
--   'wound_ahead'  the absent winder had wound it herself in advance, on
--                  an earlier overtime shift. She keeps her normal pay and
--                  nothing more; the row exists to explain why the shed ran
--                  with no winder on the floor, and to show who does it.
--
-- NOT IN SCOPE: there is deliberately no way to record "the winding did not
-- happen". Per PPK, 2026-08-24, a winder's own absence never costs her -
-- if the shed ran, the yarn was there. Money is now lost in exactly one
-- situation: the shed had no weaver at all.

BEGIN;

CREATE TABLE IF NOT EXISTS public.winder_cover (
  id                     bigserial PRIMARY KEY,
  attendance_day_id      bigint NOT NULL REFERENCES public.attendance_day(id) ON DELETE CASCADE,
  absent_employee_id     bigint NOT NULL REFERENCES public.employee(id),
  shed_no                text   NOT NULL,
  outcome                text   NOT NULL
                         CHECK (outcome IN ('covered', 'wound_ahead')),
  covered_by_employee_id bigint REFERENCES public.employee(id),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             uuid,

  -- The coverer is required for 'covered' and meaningless otherwise, so
  -- the two columns can never disagree about what the row says.
  CONSTRAINT winder_cover_outcome_ck CHECK (
    (outcome = 'covered'     AND covered_by_employee_id IS NOT NULL) OR
    (outcome = 'wound_ahead' AND covered_by_employee_id IS NULL)
  ),
  -- She cannot cover for herself; that is what 'wound_ahead' is for.
  CONSTRAINT winder_cover_not_self CHECK (
    covered_by_employee_id IS DISTINCT FROM absent_employee_id
  ),
  -- One answer per shed per shift. Re-tapping corrects, never duplicates.
  CONSTRAINT winder_cover_unique UNIQUE (attendance_day_id, absent_employee_id, shed_no)
);

CREATE INDEX IF NOT EXISTS idx_winder_cover_day
  ON public.winder_cover(attendance_day_id);
CREATE INDEX IF NOT EXISTS idx_winder_cover_absent
  ON public.winder_cover(absent_employee_id);
CREATE INDEX IF NOT EXISTS idx_winder_cover_covered_by
  ON public.winder_cover(covered_by_employee_id);

COMMENT ON TABLE public.winder_cover IS
  'What actually happened to an absent winder''s sheds in one shift. A row '
  'exists only when a supervisor confirmed it; absence of a row means the '
  'wage calculation falls back to inferring cover from attendance_entry.'
  'shed_nos. See migration 264.';

CREATE OR REPLACE FUNCTION public.fn_winder_cover_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$$;

DROP TRIGGER IF EXISTS trg_winder_cover_touch ON public.winder_cover;
CREATE TRIGGER trg_winder_cover_touch
  BEFORE UPDATE ON public.winder_cover
  FOR EACH ROW EXECUTE FUNCTION public.fn_winder_cover_touch_updated_at();

-- Same access shape as attendance_entry, which this table annotates.
ALTER TABLE public.winder_cover ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_winder_cover_read ON public.winder_cover;
CREATE POLICY p_winder_cover_read ON public.winder_cover
  FOR SELECT USING (
    public.current_user_role() = ANY (ARRAY[
      'owner'::user_role, 'auditor'::user_role,
      'mill_manager'::user_role, 'accounts'::user_role
    ])
  );

DROP POLICY IF EXISTS p_winder_cover_write ON public.winder_cover;
CREATE POLICY p_winder_cover_write ON public.winder_cover
  FOR ALL USING (
    public.current_user_role() = ANY (ARRAY['owner'::user_role, 'mill_manager'::user_role])
  );

COMMIT;
