-- 255_payment_contra_mode.sql
--
-- Fixes two defects in migration 254 found while building the contra UI.
--
-- 1. payment_mode_check does not allow 'contra':
--      CHECK (mode IN ('cash','bank','upi','neft','rtgs','cheque','card',
--                      'adjustment','fabric_adjustment','credit_note'))
--    so inserting a contra row would have been rejected outright.
--
-- 2. Because of (1), the exemption written into
--    payment_stream_direction_agree — `mode = 'contra' OR ...` — was
--    unreachable. A contra's payable half ('out' on a receivable-side
--    party, or vice versa) would have failed that check as well.
--
-- Fix: allow 'contra' as a mode, and key the exemption off
-- contra_group_id instead of the mode string. The group id is the real
-- marker: it is what links the two halves, it cannot be set by accident,
-- and it stays correct even if someone later edits the mode text.

alter table payment drop constraint if exists payment_mode_check;
alter table payment
  add constraint payment_mode_check
  check (mode in (
    'cash','bank','upi','neft','rtgs','cheque','card',
    'adjustment','fabric_adjustment','credit_note',
    -- Agreed offset between two of a party's accounts. No cash moves;
    -- mode_ledger_id stays NULL so the bank book is untouched.
    'contra'
  ));

-- Exempt contra rows from the direction/stream agreement rule. A contra
-- is precisely the case where one half is 'out' against a payable
-- account and the other 'in' against a receivable one.
alter table payment drop constraint if exists payment_stream_direction_agree;
alter table payment
  add constraint payment_stream_direction_agree
  check (
    contra_group_id is not null
    or (direction::text = 'in'  and stream in ('customer','jobwork'))
    or (direction::text = 'out' and stream in ('outsource','supplier'))
  );

-- A contra must never touch the bank/cash book: it is an offset between
-- two party accounts, not a movement of money.
alter table payment drop constraint if exists payment_contra_no_bank;
alter table payment
  add constraint payment_contra_no_bank
  check (contra_group_id is null or mode_ledger_id is null);
