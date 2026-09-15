-- ============================================================================
-- 301: Record when a reminder was actually done.
--
-- PPK, 2026-09-15: "reminder like bore motor show finished and unfinished by
-- highlight or image. tell me easy to identify that when i look at that
-- reminder".
--
-- WHY THE SCREEN COULD NOT ALREADY TELL HIM
-- Marking a repeating reminder done did not record anything. It rolled
-- due_date forward and left. So the only thing the dashboard knew was when
-- the reminder is next due — never whether it had been done. For BORE MOTOR,
-- which runs Wednesday and Saturday, "19 Sept" does not answer the question
-- PPK is actually asking, which is "did we do it this week?".
--
-- WHY A TABLE AND NOT A last_done_on COLUMN
-- A column answers only the most recent tick and quietly overwrites the one
-- before it. A row per completion costs the same to write, answers the same
-- question through MAX(done_on), and additionally keeps the history: how
-- often the bore motor actually ran against how often it was meant to. For
-- a maintenance schedule that gap is the whole point.
--
-- NO BACKFILL. reminder.updated_at moves on any edit, not just a tick, so
-- using it as a completion date would invent history that never happened.
-- Reminders start with no completions and fill in from the first tick.
--
-- Deleting a reminder takes its completions with it (ON DELETE CASCADE);
-- the app soft-deletes to status='archived' anyway, so this only matters if
-- a row is ever hard-deleted.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.reminder_completion (
  id          bigserial PRIMARY KEY,
  reminder_id bigint NOT NULL REFERENCES public.reminder(id) ON DELETE CASCADE,
  -- The date the work was done, in the mill's own calendar. Separate from
  -- created_at, which is when the button was pressed: PPK often ticks
  -- yesterday's job this morning.
  done_on     date NOT NULL DEFAULT CURRENT_DATE,
  -- The due date this tick was settling. Kept so a late tick can still be
  -- matched to the cycle it belongs to rather than to the day it was made.
  for_due_on  date,
  done_by     uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reminder_completion_reminder
  ON public.reminder_completion (reminder_id, done_on DESC);

COMMENT ON TABLE public.reminder_completion IS
  'One row each time a reminder is marked done. MAX(done_on) per reminder is "when was this last done"; the rows together are the maintenance history. See migration 301.';

-- Same rule as the reminder table itself: owner only, read and write.
ALTER TABLE public.reminder_completion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_reminder_completion_select ON public.reminder_completion;
CREATE POLICY p_reminder_completion_select ON public.reminder_completion
  FOR SELECT USING (current_user_role() = 'owner'::user_role);

DROP POLICY IF EXISTS p_reminder_completion_modify ON public.reminder_completion;
CREATE POLICY p_reminder_completion_modify ON public.reminder_completion
  FOR ALL USING (current_user_role() = 'owner'::user_role)
        WITH CHECK (current_user_role() = 'owner'::user_role);

-- Latest completion per reminder, for the dashboard and the register.
CREATE OR REPLACE VIEW public.v_reminder_last_done AS
SELECT reminder_id,
       MAX(done_on) AS last_done_on,
       COUNT(*)     AS times_done
  FROM public.reminder_completion
 GROUP BY reminder_id;

COMMENT ON VIEW public.v_reminder_last_done IS
  'When each reminder was last ticked, and how many times in total. See migration 301.';

-- Verify:
--   select * from v_reminder_last_done;   -- empty until the first tick
