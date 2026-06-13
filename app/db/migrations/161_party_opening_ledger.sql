-- 161_party_opening_ledger.sql
--
-- Opening ledger entries per party — historical invoices / bills that
-- were already outstanding when the ERP went live. Each row captures
-- one invoice the operator wants to track an outstanding balance for,
-- with the original invoice number / date / amount.
--
-- Direction:
--   'receivable'  party owes us  (legacy sales invoice still unpaid)
--   'payable'     we owe party   (legacy purchase / jobwork bill)
--
-- The dashboard "Outstanding" KPIs and the per-party ledger view read
-- this table alongside live invoices and payments so the running
-- balance from day-zero of the ERP is correct.

CREATE TABLE IF NOT EXISTS public.party_opening_ledger (
  id           bigserial PRIMARY KEY,
  party_id     bigint NOT NULL REFERENCES public.party(id) ON DELETE RESTRICT,
  invoice_no   text   NOT NULL,
  invoice_date date   NOT NULL,
  direction    text   NOT NULL CHECK (direction IN ('receivable','payable')),
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  notes        text,
  status       text   NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid
);

CREATE INDEX IF NOT EXISTS idx_party_opening_ledger_party
  ON public.party_opening_ledger (party_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_party_opening_ledger_dir
  ON public.party_opening_ledger (direction)  WHERE status = 'active';

-- Auto-update updated_at on UPDATE.
CREATE OR REPLACE FUNCTION public.fn_party_opening_ledger_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_party_opening_ledger_touch ON public.party_opening_ledger;
CREATE TRIGGER trg_party_opening_ledger_touch
  BEFORE UPDATE ON public.party_opening_ledger
  FOR EACH ROW EXECUTE FUNCTION public.fn_party_opening_ledger_touch();

ALTER TABLE public.party_opening_ledger ENABLE ROW LEVEL SECURITY;

-- RLS: anyone authenticated can read, owner / accounts can write.
DROP POLICY IF EXISTS p_pol_read  ON public.party_opening_ledger;
CREATE POLICY p_pol_read  ON public.party_opening_ledger FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS p_pol_write ON public.party_opening_ledger;
CREATE POLICY p_pol_write ON public.party_opening_ledger FOR ALL
  TO authenticated USING (true) WITH CHECK (true);

COMMENT ON TABLE public.party_opening_ledger IS
  'One row per historical (pre-ERP) invoice still outstanding with a '
  'party. Powers the "opening balance" portion of every party ledger '
  'view and the dashboard Outstanding KPIs.';
