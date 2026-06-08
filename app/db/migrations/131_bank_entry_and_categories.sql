-- 131_bank_entry_and_categories.sql
--
-- Non-party bank transactions: cash withdrawals, EB bills, loan EMI &
-- interest, bank charges, GST payments, interest received, etc.
--
-- The existing `payment` table is party-scoped (every row needs a
-- party_id). The new `bank_entry` table closes that gap so the LOOMS
-- Calibration screen + P&L report can pull a complete picture of
-- weekly / monthly cash flow.
--
-- Each entry has two sides via ledger ids:
--   bank_ledger_id  → the bank or cash account whose balance moves
--   other_ledger_id → the other side of the double-entry (EB expense,
--                     loan account, cash-in-hand, GST payable, etc.)
-- Direction tells you which side debits and which credits.
--
-- bank_category is a small lookup table for the human-readable picker.
-- pl_treatment lets the P&L loader split balance-sheet items (cash
-- withdrawals, loan principal) from period expenses without manual
-- bookkeeping.

BEGIN;

-- ── Categories master ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_category (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  -- 'out_only' / 'in_only' / 'both'
  direction       text NOT NULL CHECK (direction IN ('out_only', 'in_only', 'both')),
  -- 'expense' / 'income' / 'balance_sheet'
  pl_treatment    text NOT NULL CHECK (pl_treatment IN ('expense', 'income', 'balance_sheet')),
  display_order   integer NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.bank_category IS 'Lookup for Bank Entry categories. direction = which side of bank uses it. pl_treatment = how the P&L should classify it (expense / income / balance_sheet).';

-- Seed
INSERT INTO public.bank_category (code, name, direction, pl_treatment, display_order) VALUES
  ('EB',              'EB / Electricity Bill',  'out_only', 'expense',       10),
  ('LOAN_INTEREST',   'Loan Interest',          'out_only', 'expense',       20),
  ('BANK_CHARGES',    'Bank Charges',           'out_only', 'expense',       30),
  ('PROF_FEES',       'Professional Fees',      'out_only', 'expense',       40),
  ('INSURANCE',       'Insurance Premium',      'out_only', 'expense',       50),
  ('MAINTENANCE',     'Maintenance',            'out_only', 'expense',       60),
  ('CASH_WITHDRAW',   'Cash Withdrawal',        'out_only', 'balance_sheet', 70),
  ('LOAN_PRINCIPAL',  'Loan Principal Repaid',  'out_only', 'balance_sheet', 80),
  ('GST_PAYMENT',     'GST Payment',            'out_only', 'balance_sheet', 90),
  ('CASH_DEPOSIT',    'Cash Deposit to Bank',   'in_only',  'balance_sheet', 100),
  ('INTEREST_RECV',   'Interest Received',      'in_only',  'income',        110),
  ('LOAN_DISBURSED',  'Loan Disbursed',         'in_only',  'balance_sheet', 120),
  ('OTHER',           'Other',                  'both',     'expense',       999)
ON CONFLICT (code) DO NOTHING;

-- ── Bank Entry table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_entry (
  id                bigserial PRIMARY KEY,
  entry_no          text UNIQUE,
  entry_date        date NOT NULL DEFAULT CURRENT_DATE,
  direction         text NOT NULL CHECK (direction IN ('in', 'out')),
  amount            numeric(15,2) NOT NULL CHECK (amount > 0),
  bank_ledger_id    bigint NOT NULL REFERENCES public.ledger(id),
  other_ledger_id   bigint REFERENCES public.ledger(id),
  category_id       bigint NOT NULL REFERENCES public.bank_category(id),
  mode              text NOT NULL DEFAULT 'neft' CHECK (mode IN ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'auto_debit', 'other')),
  reference         text,
  notes             text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

CREATE INDEX IF NOT EXISTS idx_bank_entry_date     ON public.bank_entry(entry_date);
CREATE INDEX IF NOT EXISTS idx_bank_entry_bank     ON public.bank_entry(bank_ledger_id);
CREATE INDEX IF NOT EXISTS idx_bank_entry_category ON public.bank_entry(category_id);
CREATE INDEX IF NOT EXISTS idx_bank_entry_status   ON public.bank_entry(status);

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('bank_entry', 'BE', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true)
ON CONFLICT (doc_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_bank_entry_autogen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_no IS NULL OR NEW.entry_no = '' THEN
    NEW.entry_no := public.fn_next_doc_no('bank_entry');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_bank_entry_autogen ON public.bank_entry;
CREATE TRIGGER tr_bank_entry_autogen
  BEFORE INSERT ON public.bank_entry
  FOR EACH ROW EXECUTE FUNCTION public.fn_bank_entry_autogen();

-- RLS
ALTER TABLE public.bank_category ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_bank_category_select ON public.bank_category;
CREATE POLICY p_bank_category_select ON public.bank_category FOR SELECT USING (true);

ALTER TABLE public.bank_entry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_bank_entry_select ON public.bank_entry;
CREATE POLICY p_bank_entry_select ON public.bank_entry FOR SELECT USING (true);
DROP POLICY IF EXISTS p_bank_entry_modify ON public.bank_entry;
CREATE POLICY p_bank_entry_modify ON public.bank_entry FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE VIEW public.v_bank_entry
WITH (security_invoker=on) AS
SELECT
  be.id, be.entry_no, be.entry_date, be.direction, be.amount,
  be.bank_ledger_id, bl.name AS bank_name,
  be.other_ledger_id, ol.name AS other_name,
  be.category_id,
  bc.code  AS category_code,
  bc.name  AS category_name,
  bc.pl_treatment,
  be.mode, be.reference, be.notes, be.status,
  be.created_at, be.updated_at
FROM public.bank_entry be
JOIN public.bank_category bc ON bc.id = be.category_id
LEFT JOIN public.ledger bl ON bl.id = be.bank_ledger_id
LEFT JOIN public.ledger ol ON ol.id = be.other_ledger_id;

COMMIT;
