-- 269_mark_no_weaver_nights_as_holiday.sql
--
-- Five night shifts the mill did not run: no weavers, so every shed was
-- closed. Confirmed by PPK, 2026-08-24, in answer to the unrecorded-shift
-- warning added the same day.
--
--   Thu 25 Jun · Sat 18 Jul · Fri 24 Jul · Wed 12 Aug · Mon 24 Aug
--
-- Four of these had NO attendance_day row at all and were the first thing
-- the new warning caught. The fifth is tonight, recorded now so it never
-- becomes tomorrow's warning.
--
-- WHY THIS COSTS NOBODY ANYTHING
-- A non-working shift is excluded from the week entirely - the winder
-- allocation filters on is_working = true - so it never enters anyone's
-- denominator and no shed on it can be counted idle. That is exactly the
-- state these shifts were already in by being absent. The difference is
-- that the record now SAYS the mill was shut, instead of leaving the
-- question open for whoever reads it next.
--
-- reason = 'other' with a remark: the enum offers power_cut,
-- national_holiday, maintenance and other, and none of them means "no
-- weavers turned up". The remark carries the real reason.

BEGIN;

INSERT INTO public.attendance_day
  (attendance_date, shift, is_working, reason, remark, sync_source)
SELECT d::date, 'night', false, 'other',
       'No weavers - all sheds closed. Recorded 2026-08-24 (migration 269).',
       'online'
FROM (VALUES
  ('2026-06-25'), ('2026-07-18'), ('2026-07-24'),
  ('2026-08-12'), ('2026-08-24')
) AS v(d)
ON CONFLICT DO NOTHING;

COMMIT;

-- Expected: 5 rows, and the dashboard card, bell items and both banners
-- go quiet. Verify with
--   select attendance_date, shift, is_working, remark
--   from attendance_day
--   where attendance_date in ('2026-06-25','2026-07-18','2026-07-24',
--                             '2026-08-12','2026-08-24')
--     and shift = 'night'
--   order by attendance_date;
