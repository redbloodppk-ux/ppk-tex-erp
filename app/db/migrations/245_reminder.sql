-- 245_reminder.sql
--
-- Reminders / important notes — office & factory to-dos that aren't tied
-- to any other table: machine maintenance, calling a supplier, paying the
-- EB (electricity) bill, buying office/factory supplies, etc.
--
-- v1 scope (per owner's answers during brainstorming):
--   - Owner-only feature — no staff assignment/routing, so RLS is gated to
--     the 'owner' role the same way costing approval deletes are.
--   - Supports simple recurrence (daily/weekly/monthly) so a bill like the
--     EB payment doesn't need re-entering every month: marking it done
--     just rolls due_date forward and keeps status = 'active'. One-time
--     reminders get status = 'done' (or 'archived' on delete) instead.
--   - Categorised (maintenance / supplier_call / bill_payment / purchase /
--     other) for filtering on the /app/reminders page.
--   - Surfaces in two places: the existing notification bell (via
--     lib/notifications/source.ts, added in the same change) for anything
--     due today or overdue, and a dashboard widget for a slightly wider
--     upcoming+due window.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reminder (
  id          bigserial PRIMARY KEY,
  title       text NOT NULL,
  description text,
  category    text NOT NULL DEFAULT 'other'
              CHECK (category IN ('maintenance', 'supplier_call', 'bill_payment', 'purchase', 'other')),
  due_date    date NOT NULL DEFAULT CURRENT_DATE,
  repeat      text NOT NULL DEFAULT 'none'
              CHECK (repeat IN ('none', 'daily', 'weekly', 'monthly')),
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'done', 'archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

CREATE INDEX IF NOT EXISTS idx_reminder_due_date ON public.reminder(due_date);
CREATE INDEX IF NOT EXISTS idx_reminder_status   ON public.reminder(status);
CREATE INDEX IF NOT EXISTS idx_reminder_category ON public.reminder(category);

CREATE OR REPLACE FUNCTION public.fn_reminder_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END
$$;

DROP TRIGGER IF EXISTS trg_reminder_touch ON public.reminder;
CREATE TRIGGER trg_reminder_touch
  BEFORE UPDATE ON public.reminder
  FOR EACH ROW EXECUTE FUNCTION public.fn_reminder_touch_updated_at();

ALTER TABLE public.reminder ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_reminder_select ON public.reminder;
CREATE POLICY p_reminder_select ON public.reminder
  FOR SELECT USING (public.current_user_role() = 'owner'::user_role);

DROP POLICY IF EXISTS p_reminder_modify ON public.reminder;
CREATE POLICY p_reminder_modify ON public.reminder
  FOR ALL USING (public.current_user_role() = 'owner'::user_role)
  WITH CHECK (public.current_user_role() = 'owner'::user_role);

COMMIT;
