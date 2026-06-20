-- 216_so_refresh_status_towel_by_type.sql
--
-- Tighten the towel detection inside fn_so_refresh_status. Migrations 213
-- and 215 keyed the towel pcs-count -> real-metres conversion off
-- meter_per_pc > 0, but fabric / woven / dhoties qualities ALSO carry a
-- meter_per_pc (used as a count<->metre factor). That heuristic therefore
-- wrongly multiplied real metre deliveries, inflating the delivered total.
--
-- Fix: only rows whose fabric_quality.fabric_type = 'towel' store a piece
-- COUNT in `metres`; everything else is already real metres. Function body
-- is otherwise identical to migration 215 (closed/cancelled guard kept).

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_so_refresh_status(p_so_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_current      so_status;
  v_dc_count     int;
  v_inv_count    int;
  v_inv_unpaid   int;
  v_ordered      numeric;
  v_delivered    numeric;
BEGIN
  SELECT status INTO v_current FROM public.sales_order WHERE id = p_so_id;
  IF v_current IS NULL THEN RETURN; END IF;
  -- 'closed' is a manual freeze: never auto-move it.
  IF v_current IN ('cancelled','draft','pending_approval','closed') THEN RETURN; END IF;

  SELECT COUNT(*) INTO v_dc_count
  FROM public.delivery_challan
  WHERE sales_order_id = p_so_id AND status NOT IN ('cancelled');

  SELECT COUNT(*) INTO v_inv_count FROM public.invoice inv
  WHERE inv.id IN (SELECT invoice_id FROM public.delivery_challan
                   WHERE sales_order_id = p_so_id AND invoice_id IS NOT NULL);

  SELECT COUNT(*) INTO v_inv_unpaid FROM public.invoice inv
  WHERE inv.id IN (SELECT invoice_id FROM public.delivery_challan
                   WHERE sales_order_id = p_so_id AND invoice_id IS NOT NULL)
    AND COALESCE(inv.amount_paid, 0) < inv.total;

  IF v_inv_count > 0 AND v_inv_unpaid = 0 THEN
    UPDATE public.sales_order SET status='paid',
      payment_date = COALESCE(payment_date, CURRENT_DATE) WHERE id = p_so_id;
    RETURN;
  ELSIF v_inv_count > 0 THEN
    UPDATE public.sales_order SET status='invoiced' WHERE id = p_so_id;
    RETURN;
  END IF;

  IF v_dc_count = 0 THEN
    IF v_current NOT IN ('approved','in_production') THEN
      UPDATE public.sales_order SET status='approved' WHERE id = p_so_id;
    END IF;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity_m),0) INTO v_ordered
  FROM public.sales_order_line WHERE so_id = p_so_id;

  -- Only towel rows (fabric_type = 'towel') store the piece COUNT in
  -- `metres`; convert those to real metres (count × meter_per_pc) so the %
  -- comparison below is apples-to-apples. All other types are real metres.
  SELECT COALESCE(SUM(
    CASE
      WHEN fq.fabric_type = 'towel' AND COALESCE(fq.meter_per_pc, 0) > 0
        THEN dci.metres * fq.meter_per_pc
      ELSE dci.metres
    END
  ),0) INTO v_delivered
  FROM public.delivery_challan dc
  JOIN public.delivery_challan_item dci ON dci.dc_id = dc.id
  LEFT JOIN public.fabric_quality fq ON fq.id = dci.fabric_quality_id
  WHERE dc.sales_order_id = p_so_id AND dc.status NOT IN ('cancelled');

  IF v_ordered > 0 AND v_delivered >= v_ordered * 0.80 THEN
    UPDATE public.sales_order SET status='dispatched' WHERE id = p_so_id;
  ELSE
    UPDATE public.sales_order SET status='partial_dispatch' WHERE id = p_so_id;
  END IF;
END $$;

COMMIT;
