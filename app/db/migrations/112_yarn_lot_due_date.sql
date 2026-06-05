-- 112_yarn_lot_due_date.sql
--
-- Add a payment due_date to every yarn lot (and porvai lot, which
-- shares the same table). The operator enters "Due in N days" in the
-- purchase form; the app computes due_date = received_date + N and
-- writes it here so it shows up in the list view and on accounts
-- receivable reports later.

BEGIN;

ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS due_date date;

COMMENT ON COLUMN public.yarn_lot.due_date IS
  'Payment due date. Computed as received_date + N days at form save time.';

CREATE INDEX IF NOT EXISTS idx_yarn_lot_due_date ON public.yarn_lot(due_date);

COMMIT;
