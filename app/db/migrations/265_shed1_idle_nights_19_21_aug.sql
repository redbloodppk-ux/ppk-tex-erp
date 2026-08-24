-- 265_shed1_idle_nights_19_21_aug.sql
--
-- Shed 1 sat idle on the nights of Wed 19 and Fri 21 Aug 2026, but no
-- weaver row was ever entered for it. Confirmed by PPK, 2026-08-24.
--
-- WHY IT MATTERS
-- A shed-slot with NO weaver row at all is deliberately NOT treated as a
-- gap (see `deriveWeaverGapSlots`): a shed nobody was rostered on is not
-- the same as a shed that lost its weaver. That is the right default - it
-- is what stops an unmarked shift docking everyone - but it means a shed
-- that genuinely stood still pays the winder as if it had run.
--
-- KAMACHI holds sheds 1 and 3. Those two blank nights were being paid to
-- her: 10 gaps of 24 instead of 12, Rs 1,666.67 deducted instead of
-- Rs 2,000.
--
-- STATUS CHOICE
-- `none`, not `absent`. SURESH S is shed 1's night weaver and is already
-- recorded `none` on the nights of 18 and 20 Aug, which is what the mill
-- uses when a weaver is not scheduled rather than failing to turn up. The
-- shed was idle, so he was not expected. Both statuses produce a gap, so
-- this changes no arithmetic - it just avoids the record accusing him of
-- missing work he was never rostered for.
--
-- EFFECT
-- KAMACHI, week 17-23 Aug 2026 (unsettled):
--   10 gaps -> 12 of 24 · deduction Rs 1,666.67 -> Rs 2,000.00
--   book salary Rs 2,333.33 -> Rs 2,000.00

-- The row was already there. SURESH S is recorded `none` on both nights -
-- correct - but with NO shed attached, so nothing tied him to shed 1 and
-- the shed read as unrostered. Attaching the shed is the whole fix; the
-- status is already right.
--
-- Worth noting the shape of this: a `none` row with no shed is invisible
-- to the shed-level calculation, while a `none` row WITH a shed is what
-- was wrongly docking MALIGA a day earlier. The same field, empty or
-- filled, moves money in opposite directions.

BEGIN;

UPDATE public.attendance_entry ae
SET shed_no  = '1',
    shed_nos = ARRAY['1']
FROM public.attendance_day ad
WHERE ad.id = ae.attendance_day_id
  AND ae.employee_id = 1
  AND ae.status = 'none'
  AND ae.shed_no IS NULL
  AND ad.attendance_date IN (DATE '2026-08-19', DATE '2026-08-21')
  AND ad.shift = 'night'
  AND ad.is_working = true;

COMMIT;

-- Expected: 2 rows. Verify with
--   select ad.attendance_date, ad.shift, ae.status, ae.shed_no
--   from attendance_entry ae
--   join attendance_day ad on ad.id = ae.attendance_day_id
--   where ae.employee_id = 1
--     and ad.attendance_date between '2026-08-17' and '2026-08-23'
--   order by ad.attendance_date, ad.shift;
