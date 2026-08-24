-- 266_add_22aug_night_shift.sql
--
-- Sat 22 Aug 2026 night was a working shift with sheds 1 and 3 unmanned.
-- Confirmed by PPK, 2026-08-24: "closed for those two shed no weaver".
--
-- The shift had NO attendance_day row at all - it was one of four blank
-- nights (18 Jul, 24 Jul, 12 Aug, 22 Aug) where the mill neither recorded
-- the shift nor marked it a holiday. A blank night silently drops out of
-- the week, so the winders' denominator was 12 slots instead of 13 and
-- the two idle sheds cost nobody anything.
--
-- This is the difference a blank night makes to one winder:
--   KAMACHI, sheds 1 and 3, week 17-23 Aug (unsettled)
--     before: 12 gaps of 24 · deduct Rs 2,000.00 · book Rs 2,000.00
--     after:  14 gaps of 26 · deduct Rs 2,153.85 · book Rs 1,846.15
--
-- Sheds 2 and 4 are deliberately NOT marked here. Nobody has said whether
-- they ran that night, and with no weaver row a shed-slot counts as "not
-- on the roster" and pays the winder rather than docking her. That is the
-- safe direction to be wrong in while the question is open - MALIGA gains
-- two paid boxes rather than losing two she may have earned.
--
-- Worth fixing at the source: a night the mill does not run should be
-- marked a holiday, the way every Sunday already is. Three other blank
-- nights remain (18 Jul, 24 Jul, 12 Aug), left alone because their weeks
-- are settled.

BEGIN;

INSERT INTO public.attendance_day (attendance_date, shift, is_working, remark, sync_source)
VALUES (DATE '2026-08-22', 'night', true,
        'Added 2026-08-24: shift ran with sheds 1 and 3 unmanned. See migration 266.',
        'online')
ON CONFLICT DO NOTHING;

-- The night weavers for the two idle sheds: SURESH S on shed 1 (id 1) and
-- SURESH A on shed 3. `none`, not `absent` - they were not rostered, they
-- did not fail to turn up. Both statuses make the shed a gap; `none`
-- matches how the same two are recorded on the other idle nights.
INSERT INTO public.attendance_entry
  (attendance_day_id, employee_id, status, shed_no, shed_nos, sync_source)
SELECT ad.id, e.id, 'none', v.shed, ARRAY[v.shed], 'online'
FROM public.attendance_day ad
CROSS JOIN (VALUES ('SURESH S', '1'), ('SURESH A', '3')) AS v(nm, shed)
JOIN public.employee e ON e.full_name = v.nm AND e.role::text = 'weaver'
WHERE ad.attendance_date = DATE '2026-08-22' AND ad.shift = 'night'
ON CONFLICT (attendance_day_id, employee_id) DO UPDATE
  SET status = 'none', shed_no = EXCLUDED.shed_no, shed_nos = EXCLUDED.shed_nos;

COMMIT;
