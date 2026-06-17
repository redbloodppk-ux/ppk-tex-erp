-- 194_so_partial_dispatch_and_auto_link.sql
--
-- Two refinements to the Sales Order auto-status flow added in
-- migration 193:
--
-- 1) Status now distinguishes PARTIAL vs FULL dispatch.
--    Rule: delivered metres ÷ ordered metres
--      >= 80 %  → 'dispatched'
--      <  80 %  → 'partial_dispatch'
--    "Delivered" is summed live from delivery_challan_item.metres
--    across every non-cancelled DC linked to the SO. The 80 % cutoff
--    matches the operator's request ("e.g. SO 500 towels but delivery
--    < 400 → partial").
--
-- 2) DC → SO AUTO-LINK on insert/update.
--    When a delivery_challan is saved WITHOUT sales_order_id, we
--    resolve its party_id → customer.id by name match (party + customer
--    live in separate id namespaces in this DB), then look for an
--    "open" SO (status in approved / in_production / partial_dispatch)
--    for that customer whose lines reference at least one of the
--    fabric qualities present on the DC's items. Exactly ONE match →
--    sales_order_id is auto-filled. Multiple → left NULL (operator
--    picks via the DC form dropdown).
--
-- Both pieces re-trigger fn_so_refresh_status (via the existing
-- migration 193 triggers on delivery_challan) so the SO status reflects
-- reality immediately after any DC change.

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
  IF v_current IN ('cancelled','draft','pending_approval') THEN RETURN; END IF;

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

  SELECT COALESCE(SUM(dci.metres),0) INTO v_delivered
  FROM public.delivery_challan dc
  JOIN public.delivery_challan_item dci ON dci.dc_id = dc.id
  WHERE dc.sales_order_id = p_so_id AND dc.status NOT IN ('cancelled');

  IF v_ordered > 0 AND v_delivered >= v_ordered * 0.80 THEN
    UPDATE public.sales_order SET status='dispatched' WHERE id = p_so_id;
  ELSE
    UPDATE public.sales_order SET status='partial_dispatch' WHERE id = p_so_id;
  END IF;
END $$;

-- DC auto-link helper (resolves party→customer by name)
CREATE OR REPLACE FUNCTION public.fn_dc_auto_link_so_for(p_dc_id bigint)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_party_id    bigint;
  v_customer_id bigint;
  v_existing    bigint;
  v_match_count int;
  v_match_id    bigint;
BEGIN
  SELECT party_id, sales_order_id INTO v_party_id, v_existing
  FROM public.delivery_challan WHERE id = p_dc_id;
  IF v_existing IS NOT NULL OR v_party_id IS NULL THEN RETURN; END IF;

  SELECT c.id INTO v_customer_id
  FROM public.party p
  JOIN public.customer c ON UPPER(TRIM(c.name)) = UPPER(TRIM(p.name))
  WHERE p.id = v_party_id
  LIMIT 1;
  IF v_customer_id IS NULL THEN RETURN; END IF;

  WITH dc_qualities AS (
    SELECT DISTINCT fabric_quality_id FROM public.delivery_challan_item
    WHERE dc_id = p_dc_id AND fabric_quality_id IS NOT NULL
  ),
  candidates AS (
    SELECT DISTINCT so.id
    FROM public.sales_order so
    JOIN public.sales_order_line sol ON sol.so_id = so.id
    JOIN dc_qualities dq ON dq.fabric_quality_id = sol.fabric_quality_id
    WHERE so.customer_id = v_customer_id
      AND so.status IN ('approved','in_production','partial_dispatch')
  )
  SELECT COUNT(*), MIN(id) INTO v_match_count, v_match_id FROM candidates;

  IF v_match_count = 1 THEN
    UPDATE public.delivery_challan SET sales_order_id = v_match_id WHERE id = p_dc_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_dc_auto_link_so()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sales_order_id IS NOT NULL THEN RETURN NEW; END IF;
  IF NEW.party_id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.fn_dc_auto_link_so_for(NEW.id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dc_auto_link_so ON public.delivery_challan;
CREATE TRIGGER trg_dc_auto_link_so
  AFTER INSERT OR UPDATE OF party_id ON public.delivery_challan
  FOR EACH ROW EXECUTE FUNCTION public.fn_dc_auto_link_so();

CREATE OR REPLACE FUNCTION public.fn_dc_item_relink_so()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.fn_dc_auto_link_so_for(NEW.dc_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_dc_item_relink_so ON public.delivery_challan_item;
CREATE TRIGGER trg_dc_item_relink_so
  AFTER INSERT OR UPDATE OF fabric_quality_id ON public.delivery_challan_item
  FOR EACH ROW EXECUTE FUNCTION public.fn_dc_item_relink_so();

COMMIT;
