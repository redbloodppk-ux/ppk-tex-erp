-- 224_dc_cancel_manual_to_batch.sql
--
-- "Move to batch" for manually-entered DCs on cancel.
--
-- Background: a manual-entry DC has items with production_batch_id NULL. It
-- never depletes any batch stock (no production_fabric ledger outflow, no
-- fabric_stock bump), so cancelling it leaves stock untouched — the delivered
-- cloth is effectively unaccounted for.
--
-- This adds an opt-in path: when cancelling a manual DC the operator can ask
-- us to AUTO-CREATE a production batch (dated to the DC) and post the DC's
-- metres into it as available stock, so the returned cloth becomes trackable
-- under a real batch. Mirrors the two produced-fabric stores:
--   • in-house            → a production_fabric stock_ledger 'in' row
--   • jobwork / outsource → a fabric_stock row (source_type jobwork/outsourced)
--
-- A batch is costing-anchored (production_batch.costing_id and
-- fabric_stock.costing_id are both NOT NULL), but a manual DC's fabric quality
-- often has no costing linked. So the caller passes the chosen costing
-- (p_manual_costing_id) — the cancel dialog pre-selects the fabric's costing
-- when it has one, otherwise the operator picks one.
--
-- Two new parameters (both default off, so existing callers are unaffected):
--   p_move_manual_to_batch  boolean  — turn the behaviour on
--   p_manual_costing_id     bigint   — costing for the auto-created batch
--
-- The old 4-arg signature is dropped first because adding parameters changes
-- the signature (otherwise PostgREST would see an ambiguous overload).

DROP FUNCTION IF EXISTS public.fn_cancel_delivery_challan(bigint, bigint, text, boolean);

CREATE OR REPLACE FUNCTION public.fn_cancel_delivery_challan(
  p_dc_id                bigint,
  p_target_batch_id      bigint  DEFAULT NULL::bigint,
  p_reason               text    DEFAULT NULL::text,
  p_reuse_number         boolean DEFAULT true,
  p_move_manual_to_batch boolean DEFAULT false,
  p_manual_costing_id    bigint  DEFAULT NULL::bigint
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_dc           delivery_challan%ROWTYPE;
  v_doc_type     text;
  v_freed        text;
  v_seq          int;
  v_fy           text;
  v_seq_row      doc_sequence%ROWTYPE;
  v_reused       boolean := false;
  v_moved        boolean := false;
  v_manual_m     numeric := 0;
  v_manual_fq    bigint;
  v_cost         numeric := 0;
  v_new_batch    bigint;
  r              record;
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

  -- jobwork / outsource: restore fabric_stock depletion for batch-linked items.
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

  -- manual entry → new batch. Items with no production_batch_id were never
  -- tied to any batch stock. If asked, gather their metres, create a batch
  -- dated to the DC for the chosen costing, and post the metres as available
  -- produced stock (mode-appropriate store). One batch holds the DC's total
  -- manual metres; metres_available is generated, so fabric_stock writes
  -- metres_in only.
  IF p_move_manual_to_batch AND p_manual_costing_id IS NOT NULL THEN
    SELECT SUM(COALESCE(dci.metres, 0)), MIN(dci.fabric_quality_id)
      INTO v_manual_m, v_manual_fq
    FROM public.delivery_challan_item dci
    WHERE dci.dc_id = p_dc_id
      AND dci.production_batch_id IS NULL
      AND COALESCE(dci.metres, 0) > 0;

    IF COALESCE(v_manual_m, 0) > 0 THEN
      -- freeze per-metre cost from the costing's true cost (fallback 0)
      SELECT COALESCE(true_cost_per_m, 0) INTO v_cost
        FROM public.v_costing_two_cost WHERE id = p_manual_costing_id;
      v_cost := COALESCE(v_cost, 0);

      -- batch_code is auto-filled by trg_batch_autogen_code when blank
      INSERT INTO public.production_batch
        (batch_code, costing_id, production_mode, party_id,
         start_date, end_date, produced_m, entry_mode, bundles_detail, notes)
      VALUES
        ('', p_manual_costing_id, v_dc.production_mode, v_dc.party_id,
         v_dc.dc_date, v_dc.dc_date, v_manual_m, 'summary', '[]'::jsonb,
         'Auto-created from cancelled manual DC ' || COALESCE(v_dc.code, ''))
      RETURNING id INTO v_new_batch;

      IF v_dc.production_mode IN ('jobwork', 'outsource') THEN
        INSERT INTO public.fabric_stock
          (costing_id, source_type, batch_id, metres_in, metres_out,
           cost_per_m_frozen)
        VALUES
          (p_manual_costing_id,
           CASE v_dc.production_mode WHEN 'jobwork' THEN 'jobwork'
                                     ELSE 'outsourced' END,
           v_new_batch, v_manual_m, 0, v_cost);
      ELSE
        INSERT INTO public.stock_ledger
          (bucket, direction, fabric_quality_id, quantity, unit, event_date,
           source_kind, source_id, reference_no, notes)
        VALUES
          ('production_fabric', 'in', v_manual_fq, v_manual_m, 'm', v_dc.dc_date,
           'production_batch', v_new_batch, v_dc.code,
           'Auto-created batch from cancelled manual DC');
      END IF;
      v_moved := true;
    END IF;
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
    'ok',           true,
    'freed_code',   v_freed,
    'reused',       v_reused,
    'moved_batch',  v_moved,
    'new_batch_id', v_new_batch
  );
END
$function$;
