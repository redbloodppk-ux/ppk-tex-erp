-- 246_reminder_category_and_twice_weekly.sql
--
-- Two additions to the Reminders feature (migration 245):
--
--   1. Reminder categories become owner-manageable instead of a fixed
--      CHECK-constraint list. New reminder_category table (key/label),
--      seeded with the 5 categories that shipped in 245. reminder.category
--      now FKs to reminder_category.key instead of a CHECK list, so the
--      owner can add/rename/delete categories from a settings screen
--      without a migration. 'other' is marked is_system so it can't be
--      deleted (it's the fallback reassignment target).
--
--   2. A 'twice_weekly' repeat option, for things like a supplier call
--      that happens on two fixed weekdays every week (e.g. Tue & Fri).
--      New repeat_weekdays smallint[] column holds the two ISO weekday
--      numbers (1=Mon .. 7=Sun) when repeat='twice_weekly'; NULL for
--      every other repeat value.

BEGIN;

CREATE TABLE IF NOT EXISTS public.reminder_category (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false,
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.reminder_category ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_reminder_category_select ON public.reminder_category;
CREATE POLICY p_reminder_category_select ON public.reminder_category
  FOR SELECT USING (public.current_user_role() = 'owner'::user_role);

DROP POLICY IF EXISTS p_reminder_category_modify ON public.reminder_category;
CREATE POLICY p_reminder_category_modify ON public.reminder_category
  FOR ALL USING (public.current_user_role() = 'owner'::user_role)
  WITH CHECK (public.current_user_role() = 'owner'::user_role);

INSERT INTO public.reminder_category (key, label, is_system, sort_order) VALUES
  ('maintenance',   'Maintenance',    false, 1),
  ('supplier_call', 'Supplier call',  false, 2),
  ('bill_payment',  'Bill payment',   false, 3),
  ('purchase',      'Purchase',       false, 4),
  ('other',         'Other',          true,  5)
ON CONFLICT (key) DO NOTHING;

-- Swap reminder.category's CHECK constraint for a FK to reminder_category.
ALTER TABLE public.reminder DROP CONSTRAINT IF EXISTS reminder_category_check;
ALTER TABLE public.reminder
  ADD CONSTRAINT fk_reminder_category FOREIGN KEY (category)
  REFERENCES public.reminder_category(key) ON UPDATE CASCADE;

-- Twice-weekly repeat support.
ALTER TABLE public.reminder DROP CONSTRAINT IF EXISTS reminder_repeat_check;
ALTER TABLE public.reminder
  ADD CONSTRAINT reminder_repeat_check
  CHECK (repeat IN ('none', 'daily', 'weekly', 'twice_weekly', 'monthly'));

ALTER TABLE public.reminder ADD COLUMN IF NOT EXISTS repeat_weekdays smallint[];

ALTER TABLE public.reminder DROP CONSTRAINT IF EXISTS reminder_repeat_weekdays_check;
ALTER TABLE public.reminder
  ADD CONSTRAINT reminder_repeat_weekdays_check
  CHECK (
    (repeat = 'twice_weekly' AND array_length(repeat_weekdays, 1) = 2
       AND repeat_weekdays[1] BETWEEN 1 AND 7 AND repeat_weekdays[2] BETWEEN 1 AND 7
       AND repeat_weekdays[1] <> repeat_weekdays[2])
    OR (repeat <> 'twice_weekly' AND repeat_weekdays IS NULL)
  );

COMMIT;
