-- 193_sales_order_auto_status.sql
--
-- Drives sales_order.status forward as downstream documents arrive.
-- The status ladder we automate is:
--
--   approved        -> partial_dispatch / dispatched   (when a DC links here)
--   dispatched/...  -> invoiced                        (when an invoice references this SO,
--                                                       either directly via invoice.so_id
--                                                       or indirectly via DC->invoice)
--   invoiced        -> paid                            (when every linked invoice is fully
--                                                       paid: amount_paid >= total)
--
-- "Manual" states (draft, pending_approval, cancelled) are left alone
-- so the trigger never overrides an operator's deliberate choice.
--
-- Source of truth: fn_so_refresh_status recomputes status from scratch
-- each time, looking at all linked DCs / invoices. The three AFTER
-- triggers below just point at affected SOs and call it.
--
-- Note on payment: we deliberately do NOT attach a trigger on the
-- payment table - many flows update invoice.amount_paid (bulk import,
-- credit notes, reconciliation) and each would need to fan out to the
-- chain. Instead we attach to invoice UPDATE so any change to
-- amount_paid (which is the actual driver) refreshes the linked SO.

CREATE OR REPLACE FUNCTION public.fn_so_refresh_status(p_so_id bigint)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_current        so_status;
  v_dc_count       int;
  v_dc_total_m     numeric;
  v_dc_delivered_m numeric;
  v_so_total_m     numeric;
  v_inv_count      int;
  v_inv_unpaid     int;
BEGIN
  IF p_so_id IS NULL THEN RETURN; END IF;

  SELECT status INTO v_current FROM sales_order WHERE id = p_so_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Never overwrite an operator's deliberate manual state.
  IF v_current IN ('cancelled', 'draft', 'pending_approval') THEN
    RETURN;
  END IF;

  -- Active DCs against this SO (cancelled DCs don't count).
  SELECT COUNT(*) INTO v_dc_count
    FROM delivery_challan
    WHERE sales_order_id = p_so_id
      AND COALESCE(status, '') <> 'cancelled';

  -- Invoices that reference this SO. Two paths:
  --   a) invoice.so_id = p_so_id directly
  --   b) any DC for p_so_id whose invoice_id points at an invoice
  SELECT COUNT(*) INTO v_inv_count
    FROM invoice inv
    WHERE inv.status <> 'cancelled'
      AND (
        inv.so_id = p_so_id
        OR inv.id IN (
          SELECT invoice_id
          FROM delivery_challan
          WHERE sales_order_id = p_so_id
            AND invoice_id IS NOT NULL
        )
      );

  SELECT COUNT(*) INTO v_inv_unpaid
    FROM invoice inv
    WHERE inv.status <> 'cancelled'
      AND (
        inv.so_id = p_so_id
        OR inv.id IN (
          SELECT invoice_id
          FROM delivery_challan
          WHERE sales_order_id = p_so_id
            AND invoice_id IS NOT NULL
        )
      )
      AND COALESCE(inv.amount_paid, 0) < COALESCE(inv.total, 0);

  -- Partial vs full dispatch: compare SO's total quantity to delivered
  -- across its lines. delivered_m is maintained elsewhere; here we just
  -- read it.
  SELECT COALESCE(SUM(quantity_m), 0), COALESCE(SUM(delivered_m), 0)
    INTO v_so_total_m, v_dc_delivered_m
    FROM sales_order_line
    WHERE so_id = p_so_id;

  -- Climb the ladder. Each branch only updates if the target differs
  -- from the current state to avoid spurious UPDATE noise / recursion.
  IF v_inv_count > 0 AND v_inv_unpaid = 0 THEN
    IF v_current IS DISTINCT FROM 'paid' THEN
      UPDATE sales_order
        SET status = 'paid',
            payment_date = COALESCE(payment_date, CURRENT_DATE)
        WHERE id = p_so_id;
    END IF;
  ELSIF v_inv_count > 0 THEN
    IF v_current IS DISTINCT FROM 'invoiced' THEN
      UPDATE sales_order SET status = 'invoiced' WHERE id = p_so_id;
    END IF;
  ELSIF v_dc_count > 0 THEN
    -- Decide partial vs full dispatch based on delivered metres.
    IF v_so_total_m > 0 AND v_dc_delivered_m < v_so_total_m THEN
      IF v_current IS DISTINCT FROM 'partial_dispatch' THEN
        UPDATE sales_order SET status = 'partial_dispatch' WHERE id = p_so_id;
      END IF;
    ELSE
      IF v_current IS DISTINCT FROM 'dispatched' THEN
        UPDATE sales_order SET status = 'dispatched' WHERE id = p_so_id;
      END IF;
    END IF;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------
-- Trigger #1: DC insert/update
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_so_refresh_from_dc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sales_order_id IS NOT NULL THEN
      PERFORM public.fn_so_refresh_status(NEW.sales_order_id);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.sales_order_id IS NOT NULL THEN
      PERFORM public.fn_so_refresh_status(NEW.sales_order_id);
    END IF;
    -- If the DC was moved away from an SO, refresh the old one too so
    -- its status can decay (e.g. back to 'approved' if no DCs remain).
    IF OLD.sales_order_id IS NOT NULL
       AND OLD.sales_order_id IS DISTINCT FROM NEW.sales_order_id THEN
      PERFORM public.fn_so_refresh_status(OLD.sales_order_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.sales_order_id IS NOT NULL THEN
      PERFORM public.fn_so_refresh_status(OLD.sales_order_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_so_refresh_from_dc ON public.delivery_challan;
CREATE TRIGGER trg_so_refresh_from_dc
  AFTER INSERT OR UPDATE OR DELETE ON public.delivery_challan
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_so_refresh_from_dc();

-- ---------------------------------------------------------------------
-- Trigger #2: invoice insert/update
-- Covers both the "invoice raised" and "invoice paid" transitions
-- because amount_paid is updated here, not in a separate payment row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_so_refresh_from_invoice()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_so_id bigint;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    -- Direct link.
    IF NEW.so_id IS NOT NULL THEN
      PERFORM public.fn_so_refresh_status(NEW.so_id);
    END IF;
    -- Indirect link via any DC that points at this invoice.
    FOR v_so_id IN
      SELECT DISTINCT sales_order_id
      FROM delivery_challan
      WHERE invoice_id = NEW.id
        AND sales_order_id IS NOT NULL
    LOOP
      PERFORM public.fn_so_refresh_status(v_so_id);
    END LOOP;
    IF TG_OP = 'UPDATE'
       AND OLD.so_id IS NOT NULL
       AND OLD.so_id IS DISTINCT FROM NEW.so_id THEN
      PERFORM public.fn_so_refresh_status(OLD.so_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.so_id IS NOT NULL THEN
      PERFORM public.fn_so_refresh_status(OLD.so_id);
    END IF;
    FOR v_so_id IN
      SELECT DISTINCT sales_order_id
      FROM delivery_challan
      WHERE invoice_id = OLD.id
        AND sales_order_id IS NOT NULL
    LOOP
      PERFORM public.fn_so_refresh_status(v_so_id);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_so_refresh_from_invoice ON public.invoice;
CREATE TRIGGER trg_so_refresh_from_invoice
  AFTER INSERT OR UPDATE OR DELETE ON public.invoice
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_so_refresh_from_invoice();
