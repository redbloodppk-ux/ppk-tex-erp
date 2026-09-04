-- ============================================================================
-- 280: Correct costing quality names that do not exist in the quality master.
--
-- PPK, 2026-09-04, on L-34 showing the wrong cloth. Chasing it turned up a
-- second, quieter problem: costing_master.quality_name is free-typed text,
-- and three of the six costings name a quality the master has never heard of.
--
--   costing 15  "COTTON THALAPATHY 60 X 46 = 31"   master has 30"   19 beams
--   costing 16  "OE THALAPATHY 60 X 46 = 30"       master has 62"    7 beams
--   costing 12  "72X46=34" COTTON THALAPATHY"      words reversed    9 beams
--
-- These do not currently mislead the reports, because fabric_quality.costing_id
-- links each quality row back to its costing and that link is right — which is
-- why the Beam Stock Report shows the correct 30" for beam 5409 despite the
-- costing saying 31". The typed name is a second, unreliable copy sitting
-- beside a good link.
--
-- It is still worth correcting: the name IS what a person reads on the costing
-- screen, and a costing that says 31" while the cloth is 30" will eventually
-- be believed by someone. PPK confirmed 31" is a typo for 30", and the master
-- is right about OE being 62.
--
-- Only the three confirmed. Left alone deliberately:
--   costing 17 "COLOR OE 60 X 46 = 30""  - master has FABRIC and TOWEL
--                                          variants; 0 beams; ambiguous
--   costing 18 "COTTON LUREX TOWEL 34""  - master says LUREX TOWEL 72 X 46;
--                                          1 beam; close but not confirmed
--   costing 19 "Jobwork - exempt"        - deliberately not a real quality
--
-- Names only. No link, no beam, no metre changes.
-- ============================================================================

UPDATE public.costing_master SET quality_name = 'COTTON THALAPATHY 60 X 46 = 30"'
WHERE id = 15 AND quality_name = 'COTTON THALAPATHY 60 X 46 = 31"';

UPDATE public.costing_master SET quality_name = 'OE THALAPATHY 62 X 46 = 30"'
WHERE id = 16 AND quality_name = 'OE THALAPATHY 60 X 46 = 30"';

UPDATE public.costing_master SET quality_name = 'COTTON THALAPATHY 72 X 46 = 34"'
WHERE id = 12 AND quality_name = '72X46=34" COTTON THALAPATHY';

COMMENT ON COLUMN public.costing_master.quality_name IS
  'Quality name as typed when the costing was made. NOT the source of truth: fabric_quality.costing_id is the real link, and reports resolve through that. Kept readable so the costing screen does not contradict the master. See migration 280.';

-- Verify:
--   select id, quality_name from costing_master order by id;
-- Expected: 12, 15, 16 now match fabric_quality names exactly.
