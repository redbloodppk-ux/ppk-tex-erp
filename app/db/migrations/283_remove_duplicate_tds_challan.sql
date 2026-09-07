-- ============================================================================
-- 283: Remove a duplicated TDS challan row for August 2026.
--
-- PPK, 2026-09-07: "THERE are two save 310 is correct. delete 310.44
-- transaction record."
--
-- Two rows existed for period 2026-08, both challan 03667, both paid
-- 2026-09-07, both carrying the same CIN in the notes, created NINETEEN
-- SECONDS apart:
--
--   id 8   Rs 310.44   created 05:39:31
--   id 9   Rs 310.00   created 05:39:50
--
-- The first entry, then the corrected one. Between them the TDS page
-- reported Rs 620.44 remitted for a month that owed Rs 310.44 — roughly
-- double.
--
-- Deleting id 8, as instructed. The challan actually paid at the bank was
-- Rs 310, and that is the fact the books should carry.
--
-- WORTH KNOWING, AND FLAGGED TO PPK RATHER THAN SILENTLY LEFT: the tax
-- withheld on August's sizing bills computes to Rs 310.44, so once this row
-- is gone the month shows 44 paise still owed. That is not an error in the
-- data — it is a real, tiny shortfall from rounding the challan down to a
-- whole rupee, and it will sit on the TDS page until it is either paid with
-- a later challan or written off.
--
-- Verified after applying: four challan rows remain, one per month, and
-- August reads Rs 310.00 remitted.
-- ============================================================================
DELETE FROM public.tds_payment
WHERE id = 8
  AND period_month = '2026-08'
  AND amount = 310.44
  AND challan_no = '03667';

-- Verify:
--   select period_month, amount from tds_payment order by period_month;
-- Expected: 2026-04 321.98, 2026-05 617.08, 2026-06 301.28, 2026-08 310.00
