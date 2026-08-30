-- ============================================================================
-- 276: Three beams swapped off their looms on 26 Aug were marked 'removed'
--      (back to stock) when they were in fact used up.
--
-- PPK, on the Beam Stock Report filtered to "in stock": "only DOBBY KAVI
-- DHOTIES finished metre 152 is correct but remaining showing wrong why?"
--
-- The metres were right — every one matches the loom's own shift logs. What
-- was wrong is that the beams were in the list at all. The swap screen's
-- "old beam is finished" checkbox started UNCHECKED, so a beam replaced on a
-- loom silently returned to the in-stock pool carrying its woven metres.
-- Beam 2421 had woven 1280.65 m off a 1280 m beam — nothing left — and was
-- still counted as stock.
--
-- Confirmed finished by PPK, 2026-08-30:
--   assign 69,  beam 2421   1280.65 of 1280 m   (L-32, nothing left)
--   assign 95,  beam 2725    850.00 of  880 m   (L-26)
--   assign 83,  beam 4357    692.00 of  880 m   (L-14)
--
-- Beam 311391 (DOBBY KAVI, 152 of 500 m) is left alone — that one really did
-- go back to the godown part-used, which is what 'removed' is for.
--
-- Only the pavu_assign status changes. metres_produced is untouched: the
-- cloth was woven and the production figures must not move.
--
-- The screen that caused it now requires the answer instead of defaulting to
-- it, and shows metres woven / loaded / left beside the choice.
-- ============================================================================
UPDATE public.pavu_assign
SET status = 'completed'
WHERE id IN (69, 95, 83)
  AND status = 'removed';
