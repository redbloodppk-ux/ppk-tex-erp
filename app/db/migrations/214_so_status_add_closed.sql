-- 214_so_status_add_closed.sql
--
-- Adds a manual 'closed' state to the Sales Order status enum.
--
-- An order can be Closed by the operator once some goods have shipped
-- (partial_dispatch / dispatched / invoiced) but no further delivery is
-- expected — e.g. a 750-piece order where only 600 will ever go out.
-- Closing freezes the order so the auto-status trigger stops moving it
-- (see migration 215). From 'closed' the only forward action is Cancel.
--
-- NOTE: ALTER TYPE ... ADD VALUE must run in its own transaction and
-- cannot be used in the SAME transaction that references the new value,
-- which is why the trigger change lives in migration 215.

ALTER TYPE public.so_status ADD VALUE IF NOT EXISTS 'closed';
