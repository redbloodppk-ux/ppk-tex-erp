-- 327: Folder (Ravi) wage on society saree = Rs 0.30 per FOLDING metre (137 cm).
-- fn_folding_estimate now sums COALESCE(counted_metres, metres_woven) and
-- COALESCE(adjustment_counted, adjustment_metres) - counted units for saree,
-- real metres for every other quality (they have no counted value).
UPDATE fabric_quality SET folding_rate = 0.30, folding_unit = 'm' WHERE id = 14;  -- FQ-0008 SOCIETY SAREE
-- (function body: see live pg_get_functiondef('fn_folding_estimate'))
