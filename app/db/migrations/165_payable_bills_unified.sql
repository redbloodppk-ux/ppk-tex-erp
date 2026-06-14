-- 165_payable_bills_unified.sql
--
-- Surfaces sizing_job / bobbin_purchase / yarn_lot bills in the
-- Payments page Unpaid Bills list so the operator can tick them and
-- adjust a single receipt across mixed sources (live invoices +
-- opening ledger + these three new sources). Mirrors the
-- party_opening_ledger / payment_opening_allocation pattern.
--
-- A) party_id on sizing_job
--    sizing mills are stored as ledger rows (sizing_ledger_id). They
--    ALSO appear in the unified party master as Sizing Party (type 4).
--    A direct party_id link is the cleanest way for the Payments page
--    to match a job to the picked party. Backfilled by joining the
--    ledger to party via case-insensitive name.
--
-- B) amount_paid + generated balance columns
--    Each source table gets amount_paid (numeric, default 0) and a
--    GENERATED-ALWAYS-AS balance column so the front-end never has to
--    recompute the open balance.
--
-- C) payment_<source>_allocation tables
--    Three new child tables — one per source — with the same shape as
--    payment_opening_allocation. Each gets a trigger that keeps the
--    parent row's amount_paid in sync with the SUM of its allocations.
--
-- All new objects are RLS-enabled, authenticated read + write
-- (consistent with payment_opening_allocation).

-- ── A) party_id on sizing_job ─────────────────────────────────────
ALTER TABLE public.sizing_job
  ADD COLUMN IF NOT EXISTS party_id bigint REFERENCES public.party(id);

UPDATE public.sizing_job sj
SET party_id = p.id
FROM   public.ledger l
JOIN   public.party  p ON upper(p.name) = upper(l.name)
WHERE  l.id = sj.sizing_ledger_id
  AND  sj.party_id IS NULL
  AND  p.status = 'active';

CREATE INDEX IF NOT EXISTS idx_sizing_job_party_id
  ON public.sizing_job (party_id) WHERE party_id IS NOT NULL;

-- ── B) amount_paid + balance on every source ──────────────────────
-- Note: bobbin_purchase.total_amount and yarn_lot.total_amount are
-- themselves generated columns (pcs * price * (1+gst%), etc.). PG
-- doesn't allow a generated column to reference another generated
-- column, so `balance` is NOT created as a generated column. The
-- Payments page computes balance = total_amount - amount_paid in its
-- SELECT instead.
ALTER TABLE public.sizing_job
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0);

ALTER TABLE public.bobbin_purchase
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0);

ALTER TABLE public.yarn_lot
  ADD COLUMN IF NOT EXISTS amount_paid numeric(14,2) NOT NULL DEFAULT 0
    CHECK (amount_paid >= 0);

-- Backfill amount_paid from existing payment rows that already
-- point to a sizing_job via the legacy payment.sizing_job_id column.
UPDATE public.sizing_job sj
SET amount_paid = COALESCE((
  SELECT SUM(p.amount)
  FROM   public.payment p
  WHERE  p.sizing_job_id = sj.id
    AND  p.status::text NOT IN ('cancelled','void')
), 0);

-- ── C) Allocation tables + sync triggers ──────────────────────────
-- Sizing
CREATE TABLE IF NOT EXISTS public.payment_sizing_allocation (
  id            bigserial PRIMARY KEY,
  payment_id    bigint NOT NULL REFERENCES public.payment(id) ON DELETE CASCADE,
  sizing_job_id bigint NOT NULL REFERENCES public.sizing_job(id) ON DELETE RESTRICT,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid
);
CREATE INDEX IF NOT EXISTS idx_psa_pmt ON public.payment_sizing_allocation (payment_id);
CREATE INDEX IF NOT EXISTS idx_psa_job ON public.payment_sizing_allocation (sizing_job_id);

CREATE OR REPLACE FUNCTION public.fn_psa_recalc_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.sizing_job_id, OLD.sizing_job_id);
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
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_psa_recalc_paid_ins ON public.payment_sizing_allocation;
CREATE TRIGGER trg_psa_recalc_paid_ins AFTER INSERT ON public.payment_sizing_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_psa_recalc_paid();
DROP TRIGGER IF EXISTS trg_psa_recalc_paid_upd ON public.payment_sizing_allocation;
CREATE TRIGGER trg_psa_recalc_paid_upd AFTER UPDATE OF amount ON public.payment_sizing_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_psa_recalc_paid();
DROP TRIGGER IF EXISTS trg_psa_recalc_paid_del ON public.payment_sizing_allocation;
CREATE TRIGGER trg_psa_recalc_paid_del AFTER DELETE ON public.payment_sizing_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_psa_recalc_paid();

ALTER TABLE public.payment_sizing_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_psa_read  ON public.payment_sizing_allocation;
CREATE POLICY p_psa_read  ON public.payment_sizing_allocation FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS p_psa_write ON public.payment_sizing_allocation;
CREATE POLICY p_psa_write ON public.payment_sizing_allocation FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Bobbin
CREATE TABLE IF NOT EXISTS public.payment_bobbin_allocation (
  id                  bigserial PRIMARY KEY,
  payment_id          bigint NOT NULL REFERENCES public.payment(id) ON DELETE CASCADE,
  bobbin_purchase_id  bigint NOT NULL REFERENCES public.bobbin_purchase(id) ON DELETE RESTRICT,
  amount              numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid
);
CREATE INDEX IF NOT EXISTS idx_pba_pmt ON public.payment_bobbin_allocation (payment_id);
CREATE INDEX IF NOT EXISTS idx_pba_bp  ON public.payment_bobbin_allocation (bobbin_purchase_id);

CREATE OR REPLACE FUNCTION public.fn_pba_recalc_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.bobbin_purchase_id, OLD.bobbin_purchase_id);
  UPDATE public.bobbin_purchase bp
  SET amount_paid = COALESCE((
    SELECT SUM(a.amount)
    FROM   public.payment_bobbin_allocation a
    WHERE  a.bobbin_purchase_id = bp.id
  ), 0)
  WHERE bp.id = target_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pba_recalc_paid_ins ON public.payment_bobbin_allocation;
CREATE TRIGGER trg_pba_recalc_paid_ins AFTER INSERT ON public.payment_bobbin_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pba_recalc_paid();
DROP TRIGGER IF EXISTS trg_pba_recalc_paid_upd ON public.payment_bobbin_allocation;
CREATE TRIGGER trg_pba_recalc_paid_upd AFTER UPDATE OF amount ON public.payment_bobbin_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pba_recalc_paid();
DROP TRIGGER IF EXISTS trg_pba_recalc_paid_del ON public.payment_bobbin_allocation;
CREATE TRIGGER trg_pba_recalc_paid_del AFTER DELETE ON public.payment_bobbin_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pba_recalc_paid();

ALTER TABLE public.payment_bobbin_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pba_read  ON public.payment_bobbin_allocation;
CREATE POLICY p_pba_read  ON public.payment_bobbin_allocation FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS p_pba_write ON public.payment_bobbin_allocation;
CREATE POLICY p_pba_write ON public.payment_bobbin_allocation FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

-- Yarn lot
CREATE TABLE IF NOT EXISTS public.payment_yarn_allocation (
  id           bigserial PRIMARY KEY,
  payment_id   bigint NOT NULL REFERENCES public.payment(id) ON DELETE CASCADE,
  yarn_lot_id  bigint NOT NULL REFERENCES public.yarn_lot(id) ON DELETE RESTRICT,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);
CREATE INDEX IF NOT EXISTS idx_pya_pmt ON public.payment_yarn_allocation (payment_id);
CREATE INDEX IF NOT EXISTS idx_pya_yl  ON public.payment_yarn_allocation (yarn_lot_id);

CREATE OR REPLACE FUNCTION public.fn_pya_recalc_paid()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id bigint;
BEGIN
  target_id := COALESCE(NEW.yarn_lot_id, OLD.yarn_lot_id);
  UPDATE public.yarn_lot yl
  SET amount_paid = COALESCE((
    SELECT SUM(a.amount)
    FROM   public.payment_yarn_allocation a
    WHERE  a.yarn_lot_id = yl.id
  ), 0)
  WHERE yl.id = target_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pya_recalc_paid_ins ON public.payment_yarn_allocation;
CREATE TRIGGER trg_pya_recalc_paid_ins AFTER INSERT ON public.payment_yarn_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pya_recalc_paid();
DROP TRIGGER IF EXISTS trg_pya_recalc_paid_upd ON public.payment_yarn_allocation;
CREATE TRIGGER trg_pya_recalc_paid_upd AFTER UPDATE OF amount ON public.payment_yarn_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pya_recalc_paid();
DROP TRIGGER IF EXISTS trg_pya_recalc_paid_del ON public.payment_yarn_allocation;
CREATE TRIGGER trg_pya_recalc_paid_del AFTER DELETE ON public.payment_yarn_allocation
  FOR EACH ROW EXECUTE FUNCTION public.fn_pya_recalc_paid();

ALTER TABLE public.payment_yarn_allocation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_pya_read  ON public.payment_yarn_allocation;
CREATE POLICY p_pya_read  ON public.payment_yarn_allocation FOR SELECT
  TO authenticated USING (true);
DROP POLICY IF EXISTS p_pya_write ON public.payment_yarn_allocation;
CREATE POLICY p_pya_write ON public.payment_yarn_allocation FOR ALL
  TO authenticated USING (true) WITH CHECK (true);
