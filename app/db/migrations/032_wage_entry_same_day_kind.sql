-- Migration 032 — Add 'same_day' to wage_entry.kind (CORR-T4 follow-up)
--
-- Owner asked for a 'same_day' option separate from 'advance'. Used when
-- wages are paid the same day they're earned (daily-wage helpers, casual
-- labour). In that case period_start == period_end == pay_date and the
-- wage allocates only to batches active that single day.
--
-- The application form locks the period date pickers to pay_date when
-- kind = same_day and keeps the existing range behaviour for 'settlement'.
--
-- Safe to re-run: drops the old check before re-adding the new one.

BEGIN;

ALTER TABLE wage_entry DROP CONSTRAINT IF EXISTS wage_entry_kind_check;
ALTER TABLE wage_entry
  ADD CONSTRAINT wage_entry_kind_check
  CHECK (kind IN ('advance','settlement','adjustment','same_day'));

COMMIT;
