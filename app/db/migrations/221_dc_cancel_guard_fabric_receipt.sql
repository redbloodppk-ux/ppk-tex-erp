-- 221_dc_cancel_guard_fabric_receipt.sql
--
-- Adds a guard to fn_cancel_delivery_challan: a DC that already has a
-- fabric receipt raised against it cannot be cancelled.
--
-- Why:
--   A jobwork / outsource DC is often "received" later — a fabric_receipt
--   is cut from it and delivery_challan.fabric_receipt_id is set. Cancelling
--   the DC at that point would leave the receipt pointing at a cancelled
--   (number-freed) challan. The clean lifecycle already exists: deleting /
--   cancelling the fabric receipt resets the DC back to 'draft' and clears
--   fabric_receipt_id (see fabric-receipt actions). So we simply block the
--   cancel while the link is live and tell the operator to remove the
--   receipt first — mirroring the existing invoice_id guard.
--
-- Only the guard is new; the rest of the function is unchanged from 220.
-- CREATE OR REPLACE so it is safe to run more than once.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cancel_delivery_challan(
  p_dc_id           bigint,
  p_target_batch_id bigint  DEFAULT NULL,
  p_reason          text    DEFAULT NULL,
  p_reuse_number    boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_dc         delivery_challan%ROWTYPE;
  v_doc_type   text;
  v_freed      text;
  v_seq        int;
  v_fy         text;
  v_seq_row    doc_sequence%ROWTYPE;
  v_reused     boolean := false;
  v_moved      boolean := false;
  r            record;
BEGIN
  SELECT * INTO v_dc FROM public.delivery_challan WHERE id = p_dc_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery challan % not found', p_dc_id;
  END IF;
  IF v_dc.status = 'cancelled' THEN
    RAISE EXCEPTION 'This delivery challan is already cancelled.';
  END IF;
  IF v_dc.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'This DC is linked to an invoice. Remove it from the invoice before cancelling.';
  END IF;
  IF v_dc.fabric_receipt_id IS NOT NULL THEN
    RAISE EXCEPTION 'This DC has a fabric receipt raised against it. Delete the fabric receipt before cancelling.';
  END IF;

  -- 2a. Reverse production-batch outflows + optional move to a new batch.
  --     One row per un-reversed outflow tied to this DC's items.
  FOR r IN
    SELECT sl.source_id              AS item_id,
           sl.fabric_quality_id      AS fq_id,
           sl.quantity               AS qty,
           sl.unit                   AS unit,
           dci.production_batch_id   AS orig_batch_id
    FROM public.stock_ledger sl
    JOIN public.delivery_challan_item dci ON dci.id = sl.source_id
    WHERE sl.bucket = 'production_fabric'
      AND sl.source_kind = 'delivery_challan_item'
      AND sl.direction = 'out'
      AND dci.dc_id = p_dc_id
      AND NOT EXISTS (
        SELECT 1 FROM public.stock_ledger x
        WHERE x.bucket = 'production_fabric'
          AND x.source_kind = 'delivery_challan_item'
          AND x.source_id = sl.source_id
          AND x.direction = 'in'
      )
  LOOP
    -- Restore the delivered stock to the ORIGINAL batch (item-level 'in').
    INSERT INTO public.stock_ledger
      (bucket, direction, fabric_quality_id, quantity, unit, event_date,
       source_kind, source_id, reference_no, notes)
    VALUES
      ('production_fabric', 'in', r.fq_id, r.qty, r.unit, CURRENT_DATE,
       'delivery_challan_item', r.item_id, v_dc.code,
       'Returned on DC cancel');

    -- If a different target batch was chosen, move the returned quantity
    -- from the original batch to the target at the production_batch level.
    IF p_target_batch_id IS NOT NULL
       AND r.orig_batch_id IS NOT NULL
       AND p_target_batch_id <> r.orig_batch_id THEN
      INSERT INTO public.stock_ledger
        (bucket, direction, fabric_quality_id, quantity, unit, event_date,
         source_kind, source_id, reference_no, notes)
      VALUES
        ('production_fabric', 'out', r.fq_id, r.qty, r.unit, CURRENT_DATE,
         'production_batch', r.orig_batch_id, v_dc.code,
         'Moved out on DC cancel'),
        ('production_fabric', 'in', r.fq_id, r.qty, r.unit, CURRENT_DATE,
         'production_batch', p_target_batch_id, v_dc.code,
         'Moved in on DC cancel');
      v_moved := true;
    END IF;
  END LOOP;

  -- 2b. Free the number and mark cancelled.
  v_freed := v_dc.code;
  UPDATE public.delivery_challan
    SET status        = 'cancelled',
        cancelled_at  = now(),
        cancel_reason = p_reason,
        void_code     = COALESCE(v_dc.code, void_code),
        code          = NULL,
        updated_at    = now()
    WHERE id = p_dc_id;

  -- 2c. Reclaim the number when asked and when this DC holds the latest
  --     issued number for its sequence (so reuse never duplicates a live
  --     number). Older cancellations leave a gap by design.
  IF p_reuse_number AND v_freed IS NOT NULL THEN
    v_doc_type := CASE v_dc.production_mode
                    WHEN 'jobwork'   THEN 'jobwork_dc'
                    WHEN 'outsource' THEN 'outsource_dc'
                    ELSE 'dc'
                  END;
    v_seq := NULLIF((regexp_match(v_freed, '(\d+)\s*$'))[1], '')::int;
    v_fy  := (regexp_match(v_freed, '([0-9]{2}-[0-9]{2})'))[1];

    SELECT * INTO v_seq_row FROM public.doc_sequence
      WHERE doc_type = v_doc_type FOR UPDATE;
    IF FOUND
       AND v_seq IS NOT NULL
       AND v_seq_row.fy_code IS NOT DISTINCT FROM v_fy
       AND v_seq_row.next_value - 1 = v_seq THEN
      UPDATE public.doc_sequence
        SET next_value = next_value - 1, updated_at = now()
        WHERE doc_type = v_doc_type;
      v_reused := true;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'freed_code',  v_freed,
    'reused',      v_reused,
    'moved_batch', v_moved
  );
END
$fn$;

COMMIT;
