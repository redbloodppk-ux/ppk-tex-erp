-- 261_fix_batch24_congress_ends.sql
--
-- Data correction for warp beam batch WBG-0024 (10 beams, 21-Aug-2026).
--
-- The batch was re-tagged to CONGRESS RUNNING FABRIC, but batch edit did
-- not cascade the quality's ends at the time, so the beams kept 2190 from
-- the previous quality. CONGRESS is a 2200-ends quality (every earlier
-- CONGRESS batch - WBG-0019, WBG-0023 - is 2200), and the owner confirmed
-- these beams were physically warped at 2200.
--
-- Effect of the wrong value: the Pavu-assign screen matches in-stock beams
-- on (pavu.ends + warp count + quality) against the loom's quality. At 2190
-- these 10 in-stock CONGRESS beams failed the ends check, so loom L-46 -
-- set to CONGRESS - showed an empty pavu list and looked like it had no
-- stock, while 10 beams sat available.
--
-- Both sides are corrected: jobwork_warp_beam.total_ends AND the linked
-- pavu.ends, because the loom screen reads pavu and the warp reports read
-- the beam row.
--
-- Snapshot taken immediately before (auto_backup id 7).
--
-- The code fixes that stop this recurring are in dfce75d (batch edit
-- cascades quality -> ends + warp count) and ace3b0e (beam edits cascade
-- ends onto the linked pavu).

update pavu p
set ends = 2200
from jobwork_warp_beam w
where w.pavu_id = p.id
  and w.batch_no = 24
  and w.fabric_quality_id = 9      -- CONGRESS RUNNING FABRIC
  and w.status = 'active'
  and p.ends = 2190;

update jobwork_warp_beam
set total_ends = 2200
where batch_no = 24
  and fabric_quality_id = 9
  and status = 'active'
  and total_ends = 2190;

-- Verified after applying: all 10 beams and their pavus read 2200 and are
-- in_stock; all 10 now pass the assign screen's ends + warp count +
-- quality checks for a CONGRESS loom. The 8 in-stock DOBBY KAVI beams that
-- also carry 2200 ends still correctly fail the quality check.
