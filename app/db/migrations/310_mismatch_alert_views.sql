-- ============================================================================
-- 310: Two "something disagrees" checks for the notification bell, each of
--      which opens the screen where it is fixed.
--
-- 1. v_dc_receipt_mismatch — a DC whose quantity no longer matches its
--    fabric receipt. PPK, 2026-09-26: JDC/26-27/0059 was corrected 705 ->
--    702 but FR/26-27/0121 still consumed warp/weft/bobbin for 705.
--    Receipt quantity = pieces for 'pcs' lines, received metres otherwise,
--    which is what the DC's total_metres holds for each (checked: 0 rows
--    today, so no false alarms).
-- 2. v_shift_log_beam_mismatch — shift-log rows (last 30 days) whose
--    quality differs from the beam on that loom that day. PPK, 2026-09-26:
--    L-31 on 23 Sep saved as 30" while beam 3767 (34") was on it.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_dc_receipt_mismatch WITH (security_invoker = true) AS
WITH r AS (
  SELECT fr.id AS receipt_id, fr.code AS receipt_code, fr.dc_id,
         SUM(CASE WHEN fri.entry_mode = 'pcs' THEN fri.no_of_pieces ELSE fri.received_metres END) AS receipt_qty
    FROM fabric_receipt fr
    JOIN fabric_receipt_item fri ON fri.receipt_id = fr.id
   WHERE fr.dc_id IS NOT NULL
     AND fr.status <> 'draft'
   GROUP BY fr.id, fr.code, fr.dc_id
)
SELECT d.id AS dc_id, d.code AS dc_code, d.dc_date, d.bill_to_name,
       d.total_metres AS dc_qty, r.receipt_id, r.receipt_code, r.receipt_qty,
       GREATEST(d.updated_at, d.created_at) AS changed_at
  FROM r
  JOIN delivery_challan d ON d.id = r.dc_id
 WHERE d.status::text <> 'cancelled'
   AND ABS(COALESCE(d.total_metres, 0) - COALESCE(r.receipt_qty, 0)) > 0.5;

COMMENT ON VIEW public.v_dc_receipt_mismatch IS
  'DCs whose quantity differs from their linked fabric receipt (receipt must be edited to re-apply stock).';

CREATE OR REPLACE VIEW public.v_shift_log_beam_mismatch WITH (security_invoker = true) AS
SELECT sl.id AS shift_log_id, sl.log_date, sl.shift, sl.loom_id, l.loom_code,
       sl.fabric_quality_id AS logged_quality_id, fl.name AS logged_quality,
       b.beam_quality_id, fb.name AS beam_quality
  FROM production_shift_log sl
  JOIN loom l ON l.id = sl.loom_id
  CROSS JOIN LATERAL (SELECT public.fn_loom_quality_id_on_date(sl.loom_id, sl.log_date) AS beam_quality_id) b
  LEFT JOIN fabric_quality fl ON fl.id = sl.fabric_quality_id
  LEFT JOIN fabric_quality fb ON fb.id = b.beam_quality_id
 WHERE sl.log_date >= CURRENT_DATE - 30
   AND b.beam_quality_id IS NOT NULL
   AND b.beam_quality_id IS DISTINCT FROM sl.fabric_quality_id;

COMMENT ON VIEW public.v_shift_log_beam_mismatch IS
  'Shift-log rows in the last 30 days whose quality differs from the beam mounted on the loom that day.';
