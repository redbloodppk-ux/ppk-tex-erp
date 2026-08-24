-- 268_22aug_night_sheds_2_and_4.sql
--
-- Sat 22 Aug 2026 night: VIJI wove shed 2, RAVI wove shed 4.
-- Confirmed by PPK, 2026-08-24.
--
-- MY MISTAKE, RECORDED SO IT IS NOT REPEATED
-- Migration 266 created this night shift but only wrote the two rows I had
-- been told about - SURESH S on shed 1 and SURESH A on shed 3, both idle.
-- Every other weaver was left with no row at all:
--
--   Thu 20 night   9 weaver rows
--   Fri 21 night   9 weaver rows
--   Sat 22 night   2 weaver rows  <- both mine
--
-- So the shift was really unmarked and merely LOOKED marked. The
-- blank-is-idle rule then read sheds 2 and 4 as idle and docked MALIGA
-- Rs 338.46 for a night she had earned. Creating a shift without its
-- attendance is worse than leaving the shift missing.
--
-- The guard in `deriveWeaverGapSlots` was supposed to prevent exactly
-- this - it only infers idle for slots that have SOME weaver row - but two
-- rows satisfied it. Tightened in the same commit: a slot now counts as
-- marked only if its row count is at least half the busiest slot of the
-- week, so a part-entered shift no longer qualifies.
--
-- EFFECT
-- MALIGA, week 17-23 Aug 2026 (unsettled):
--   4 gaps of 26 -> 2 · book salary Rs 3,723.08 -> Rs 4,061.54
-- KAMACHI unchanged at 14 of 26: her gaps come from rows that exist and
-- show nobody working, not from blanks.

BEGIN;

INSERT INTO public.attendance_entry
  (attendance_day_id, employee_id, status, shed_no, shed_nos, sync_source)
SELECT ad.id, e.id, 'present', v.shed, ARRAY[v.shed], 'online'
FROM public.attendance_day ad
CROSS JOIN (VALUES ('VIJI', '2'), ('RAVI - WEAVER', '4')) AS v(nm, shed)
JOIN public.employee e ON e.full_name = v.nm AND e.role::text = 'weaver'
WHERE ad.attendance_date = DATE '2026-08-22' AND ad.shift = 'night'
ON CONFLICT (attendance_day_id, employee_id) DO UPDATE
  SET status   = 'present',
      shed_no  = EXCLUDED.shed_no,
      shed_nos = EXCLUDED.shed_nos;

COMMIT;

-- The rest of that night's attendance is still not entered. It does not
-- affect any wage now that all four sheds carry a row, but the shift is
-- incomplete and should be marked properly on the attendance screen.
