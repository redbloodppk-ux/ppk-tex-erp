-- 223_dc_cancel_restore_fabric_stock.sql
--
-- Full parity for jobwork / outsource DC cancellation.
--
-- Background: in-house DCs deplete a production batch through the
-- production_fabric stock_ledger, and fn_cancel_delivery_challan already
-- reverses those outflows (returning the cloth to its batch) on cancel.
--
-- jobwork / outsource batches never touch that ledger. Their produced
-- fabric lives in fabric_stock (one row per batch, source_type 'jobwork' /
-- 'outsourced'), and the DC form now depletes it by bumping
-- fabric_stock.metres_out at save time. This migration extends the cancel
-- function so cancelling a jobwork / outsource DC subtracts those metres
-- back out of metres_out, returning the fabric to its respective batch's
-- available stock — mirroring the in-house behaviour.
--
-- metres_available is a generated column (metres_in - metres_out), so we
-- only ever adjust metres_out, and clamp at 0 with GREATEST.

CREATE OR REPLACE FUNCTION public.fn_cancel_delivery_challan(p_dc_id bigint, p_target_batch_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text, p_reuse_number boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- in-house: reverse the production_fabric ledger outflows
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
    INSERT INTO public.stock_ledger
      (bucket, direction, fabric_quality_id, quantity, unit, event_date,
       source_kind, source_id, reference_no, notes)
    VALUES
      ('production_fabric', 'in', r.fq_id, r.qty, r.unit, CURRENT_DATE,
       'delivery_challan_item', r.item_id, v_dc.code,
       'Returned on DC cancel');

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

  -- jobwork / outsource: restore fabric_stock depletion. These DCs never
  -- write production_fabric ledger rows; their delivered metres were added
  -- to fabric_stock.metres_out at save time. Subtract them back per batch so
  -- the produced fabric returns to its respective batch's available stock
  -- (mirrors the in-house ledger reversal above). metres_available is a
  -- generated column, so we only adjust metres_out.
  IF v_dc.production_mode IN ('jobwork', 'outsource') THEN
    FOR r IN
      SELECT dci.production_batch_id AS batch_id,
             SUM(COALESCE(dci.metres, 0)) AS qty
      FROM public.delivery_challan_item dci
      WHERE dci.dc_id = p_dc_id
        AND dci.production_batch_id IS NOT NULL
        AND COALESCE(dci.metres, 0) > 0
      GROUP BY dci.production_batch_id
    LOOP
      UPDATE public.fabric_stock fs
        SET metres_out = GREATEST(0, fs.metres_out - r.qty)
        WHERE fs.batch_id = r.batch_id
          AND fs.source_type = CASE v_dc.production_mode
                                  WHEN 'jobwork' THEN 'jobwork'
                                  ELSE 'outsourced'
                                END;
    END LOOP;
  END IF;

  v_freed := v_dc.code;
  UPDATE public.delivery_challan
    SET status        = 'cancelled',
        cancelled_at  = now(),
        cancel_reason = p_reason,
        void_code     = COALESCE(v_dc.code, void_code),
        code          = NULL,
        updated_at    = now()
    WHERE id = p_dc_id;

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
$function$;
