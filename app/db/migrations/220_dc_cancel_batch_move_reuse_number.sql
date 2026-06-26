-- 220_dc_cancel_batch_move_reuse_number.sql
--
-- Delivery Challan cancellation that (a) optionally moves the delivered
-- production-batch stock back into a chosen batch, and (b) frees the DC
-- number so the next DC can reuse it (no gap in the sequence).
--
-- Why this is needed:
--   When a DC is raised against an in-house production batch the save
--   path writes a stock_ledger OUTFLOW (bucket='production_fabric',
--   source_kind='delivery_challan_item') that depletes that batch's
--   finished-fabric stock. If the delivery is later cancelled the goods
--   come back — but nothing reverses that outflow, so the batch wrongly
--   stays empty. Operators also don't want to "waste" the DC number on a
--   voided challan; they want the next DC to reuse it.
--
-- What this migration adds:
--   1. delivery_challan.void_code / cancelled_at / cancel_reason columns,
--      and drops NOT NULL on `code` so a cancelled DC can release its
--      number (code is set to NULL; the old number is kept in void_code
--      for the audit trail / on-screen display).
--   2. fn_cancel_delivery_challan(p_dc_id, p_target_batch_id, p_reason,
--      p_reuse_number):
--        • Reverses every un-reversed production-batch outflow for the DC
--          (writes the inverse 'in' row, restoring stock to the ORIGINAL
--          batch). This is the picker/warehouse model already anticipated
--          by the dc-form comments.
--        • If p_target_batch_id is given and differs from the original
--          batch, additionally transfers the returned quantity from the
--          original batch to the chosen one at the production_batch level
--          (an 'out' on the original + an 'in' on the target). The
--          warehouse fabric pivot nets per quality so the transfer is
--          quality-neutral there; the DC batch-picker nets per batch so
--          the stock correctly relocates to the chosen batch.
--        • Frees the number: copies code -> void_code, sets code = NULL,
--          and — when p_reuse_number is true AND this DC holds the most
--          recently issued number for its sequence — decrements
--          doc_sequence.next_value so the very next DC reuses it.
--        • Marks the DC cancelled (status, cancelled_at, cancel_reason).
--
-- Safe to run more than once: column adds are guarded, the function is
-- CREATE OR REPLACE, and the reversal step skips outflows that were
-- already reversed.

BEGIN;

-- ── 1. Columns ───────────────────────────────────────────────────────────────
ALTER TABLE public.delivery_challan
  ADD COLUMN IF NOT EXISTS void_code     text,
  ADD COLUMN IF NOT EXISTS cancelled_at  timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- A cancelled DC releases its number, so `code` must be nullable. The
-- UNIQUE constraint stays — Postgres treats NULLs as distinct, so any
-- number of cancelled DCs can sit at NULL without colliding.
ALTER TABLE public.delivery_challan
  ALTER COLUMN code DROP NOT NULL;

COMMENT ON COLUMN public.delivery_challan.void_code IS
  'The DC number this challan held before it was cancelled. `code` is '
  'nulled on cancel so the number can be reused; void_code preserves it '
  'for display and audit.';

-- ── 2. Cancellation function ─────────────────────────────────────────────────
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

GRANT EXECUTE ON FUNCTION public.fn_cancel_delivery_challan(bigint, bigint, text, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.fn_cancel_delivery_challan(bigint, bigint, text, boolean) IS
  'Cancels a delivery challan: reverses production-batch outflows '
  '(optionally relocating the returned stock to p_target_batch_id), '
  'releases the DC number (code -> void_code, code NULL) and — when '
  'p_reuse_number is true and this DC holds the latest issued number — '
  'decrements the doc_sequence so the next DC reuses it.';

COMMIT;
