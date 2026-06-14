-- 166_sizing_payment_legacy_sync.sql
--
-- Migration 165 added sizing_job.amount_paid plus a trigger on
-- payment_sizing_allocation (fn_psa_recalc_paid) that recomputes
-- amount_paid as:
--   SUM(payment_sizing_allocation.amount)
--   + SUM(payment.amount WHERE payment.sizing_job_id = sj.id)
-- That handles the new Payments-page flow correctly but leaves a gap
-- for the LEGACY `payment.sizing_job_id` writes/deletes — used by old
-- rows and by the Sizing → Payment history "Delete" button — because
-- a direct change to the payment table never fires the allocation
-- trigger. The sizing_job.amount_paid would then drift out of sync.
--
-- This migration adds a parallel trigger on public.payment that
-- reruns the same recomputation whenever a row that touches a
-- sizing_job is inserted, updated, or deleted.

CREATE OR REPLACE FUNCTION public.fn_payment_resync_sizing_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.sizing_job_id, OLD.sizing_job_id);
  IF target_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  UPDATE public.sizing_job sj
  SET amount_paid = COALESCE((
    SELECT SUM(a.amount)
    FROM   public.payment_sizing_allocation a
    WHERE  a.sizing_job_id = sj.id
  ), 0)
                  + COALESCE((
    SELECT SUM(p.amount)
    FROM   public.payment p
    WHERE  p.sizing_job_id = sj.id
      AND  p.status::text NOT IN ('cancelled','void')
  ), 0)
  WHERE sj.id = target_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_resync_sizing_ins ON public.payment;
CREATE TRIGGER trg_payment_resync_sizing_ins
  AFTER INSERT ON public.payment
  FOR EACH ROW
  WHEN (NEW.sizing_job_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_payment_resync_sizing_paid();

DROP TRIGGER IF EXISTS trg_payment_resync_sizing_upd ON public.payment;
CREATE TRIGGER trg_payment_resync_sizing_upd
  AFTER UPDATE ON public.payment
  FOR EACH ROW
  WHEN (NEW.sizing_job_id IS NOT NULL OR OLD.sizing_job_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_payment_resync_sizing_paid();

DROP TRIGGER IF EXISTS trg_payment_resync_sizing_del ON public.payment;
CREATE TRIGGER trg_payment_resync_sizing_del
  AFTER DELETE ON public.payment
  FOR EACH ROW
  WHEN (OLD.sizing_job_id IS NOT NULL)
  EXECUTE FUNCTION public.fn_payment_resync_sizing_paid();
