-- 263_pachaiyamaal_stale_shed_row.sql
--
-- One row, one winder, Rs 183.33. Recorded as a migration because it is a
-- money correction and should be reproducible, not a quiet UPDATE.
--
-- THE RULE (confirmed by PPK, 2026-08-23)
-- A winder works the MORNING. The shed she winds that morning carries
-- through both shifts of that day, so she is paid for both. She is paid
-- for sheds she actually wound - presence in the morning is what earns it.
--
-- THE ROW
-- PACHAIYAMAAL (EMP-0022, id 32) worked two days and left:
--
--   Wed 22 Jul  morning  present  shed 4   <- wound it
--   Thu 23 Jul  morning  present  shed 4   <- wound it
--   Thu 23 Jul  night    none     shed 4   <- correct: carried from the morning
--   Fri 24 Jul  morning  absent   -
--   Sat 25 Jul  morning  absent   -        <- did not wind anything
--   Sat 25 Jul  night    none     shed 4   <- WRONG: nothing to carry
--
-- The last row still carries shed 4 even though she was absent that
-- morning. It is the same artefact that was docking MALIGA: the default
-- shed sticks to an auto-created row for a shift the person does not work.
-- ASHOK, SUBRAMANI and SURESH A all carry the same thing on their night
-- rows. Here it pays out instead of docking, because a `none` status
-- credits a winder for a shed she is holding.
--
-- Detaching the shed leaves the attendance record honest - she was not
-- there, and the row still says `none` - while stopping the payment.
--
-- EFFECT
-- Week 20-26 Jul 2026, her book salary: Rs 733.33 -> Rs 550.00
--   = 2200 / 12 slots x 3 shed-slots (22 morning, 23 morning, 23 night)
--
-- No wage_entry is written here. She has not been paid yet; recording a
-- settlement before the money moves would be a lie in the ledger.

update attendance_entry ae
set shed_no  = null,
    shed_nos = null
from attendance_day ad
where ad.id = ae.attendance_day_id
  and ae.employee_id = 32
  and ad.attendance_date = date '2026-07-25'
  and ad.shift = 'night'
  and ae.status = 'none';

-- Expected: 1 row. Verify with
--   select ad.attendance_date, ad.shift, ae.status, ae.shed_no
--   from attendance_entry ae join attendance_day ad on ad.id = ae.attendance_day_id
--   where ae.employee_id = 32 order by 1, 2;
