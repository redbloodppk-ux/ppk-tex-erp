-- 145_backfill_stock_ledger_jobwork_party.sql
--
-- Historical stock_ledger rows for warp_beam / weft_yarn / porvai_yarn
-- / bobbin outflows were written before the receipt-save flow knew to
-- tag stock_ledger.jobwork_party_id. As a result the Warehouse →
-- Job Work pivots couldn't find their outflow events.
--
-- Resolve by walking back the chain:
--   stock_ledger.reference_no = fabric_receipt.code
--                             → delivery_challan (production_mode)
--                             → party.name
--                             → jobwork_party.id (kind matches mode)
-- and writing the resolved id onto the ledger row.
--
-- Forward-looking fix (already shipped): the receipt-save flow now
-- threads jobwork_party_id through ReceiptContext so new receipts
-- never need this backfill again. This migration only handles the
-- legacy rows.
--
-- Result counts at apply time (2026-06-09):
--   warp_beam  : 20 / 21 NULLs filled
--   weft_yarn  : 20 / 21 NULLs filled
--   porvai_yarn: 0  / 0  NULLs (no rows existed)
--   bobbin     : 8  / 8  NULLs filled (applied earlier inline)

UPDATE public.stock_ledger sl
SET    jobwork_party_id = jp.id
FROM   public.fabric_receipt fr
JOIN   public.delivery_challan dc ON dc.id = fr.dc_id
JOIN   public.party p              ON p.id = dc.party_id
JOIN   public.jobwork_party jp     ON jp.name = p.name
                                  AND jp.kind = (
                                    CASE WHEN dc.production_mode = 'outsource'
                                         THEN 'outsource'
                                         ELSE 'jobwork'
                                    END
                                  )
WHERE  sl.bucket IN ('warp_beam', 'weft_yarn', 'porvai_yarn', 'bobbin')
  AND  sl.jobwork_party_id IS NULL
  AND  fr.code = sl.reference_no
  AND  dc.production_mode IN ('jobwork', 'outsource');
