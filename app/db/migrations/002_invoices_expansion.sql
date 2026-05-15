-- ────────────────────────────────────────────────────────────────────────────
-- Migration 002 — Expand Invoices for 5 doc types + full Indian GST
-- ────────────────────────────────────────────────────────────────────────────
-- Adds: tax_invoice (fabric), yarn_sale, general_sale, credit_note (sales
-- return), debit_note (purchase return). Each line carries HSN/SAC, GST rate,
-- CGST+SGST or IGST split, and optional source linkage (sales order, fabric
-- stock, yarn lot, or original invoice line for returns).
-- Tables are empty so it's safe to drop generated columns and rename.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_doc_type') THEN
    CREATE TYPE invoice_doc_type AS ENUM (
      'tax_invoice',   -- fabric sale (kept as default for back-compat)
      'yarn_sale',     -- yarn outward
      'general_sale',  -- rental income, scrap, services
      'credit_note',   -- sales return / customer credit
      'debit_note'     -- purchase return / vendor debit
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invoice_source_kind') THEN
    CREATE TYPE invoice_source_kind AS ENUM (
      'sales_order',
      'fabric_stock',
      'yarn_lot',
      'free',
      'return'
    );
  END IF;
END $$;

-- ── invoice ────────────────────────────────────────────────────────────────
ALTER TABLE invoice
  ADD COLUMN IF NOT EXISTS doc_type      invoice_doc_type    NOT NULL DEFAULT 'tax_invoice',
  ADD COLUMN IF NOT EXISTS source_kind   invoice_source_kind NOT NULL DEFAULT 'sales_order',
  ADD COLUMN IF NOT EXISTS vendor_id     bigint REFERENCES vendor(id),
  ADD COLUMN IF NOT EXISTS party_name    text,
  ADD COLUMN IF NOT EXISTS party_gstin   text,
  ADD COLUMN IF NOT EXISTS party_state   text,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS is_interstate boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS taxable_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS round_off     numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS original_invoice_id bigint REFERENCES invoice(id);

ALTER TABLE invoice ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE invoice DROP CONSTRAINT IF EXISTS invoice_party_check;
ALTER TABLE invoice ADD CONSTRAINT invoice_party_check CHECK (
  (doc_type = 'debit_note' AND vendor_id   IS NOT NULL AND customer_id IS NULL)
  OR
  (doc_type <> 'debit_note' AND customer_id IS NOT NULL AND vendor_id   IS NULL)
);

ALTER TABLE invoice DROP CONSTRAINT IF EXISTS invoice_return_check;
ALTER TABLE invoice ADD CONSTRAINT invoice_return_check CHECK (
  doc_type NOT IN ('credit_note','debit_note') OR original_invoice_id IS NOT NULL
);

-- ── invoice_line ───────────────────────────────────────────────────────────
-- Drop the generated 'amount' so we can rename quantity_m / rate_per_m to
-- generic names. Tables are empty.
ALTER TABLE invoice_line DROP COLUMN IF EXISTS amount;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='invoice_line' AND column_name='quantity_m') THEN
    ALTER TABLE invoice_line RENAME COLUMN quantity_m TO quantity;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='invoice_line' AND column_name='rate_per_m') THEN
    ALTER TABLE invoice_line RENAME COLUMN rate_per_m TO rate;
  END IF;
END $$;

ALTER TABLE invoice_line
  ADD COLUMN IF NOT EXISTS hsn_sac        text,
  ADD COLUMN IF NOT EXISTS uom            text NOT NULL DEFAULT 'mtr',
  ADD COLUMN IF NOT EXISTS discount_pct   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gst_rate_pct   numeric NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cgst_amount    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount    numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount   numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yarn_lot_id    bigint REFERENCES yarn_lot(id),
  ADD COLUMN IF NOT EXISTS fabric_stock_id bigint REFERENCES fabric_stock(id),
  ADD COLUMN IF NOT EXISTS resale_lot_id  bigint REFERENCES resale_lot(id),
  ADD COLUMN IF NOT EXISTS so_line_id     bigint REFERENCES sales_order_line(id),
  ADD COLUMN IF NOT EXISTS original_line_id bigint REFERENCES invoice_line(id);

-- ── doc_sequence rows for the new doc types ────────────────────────────────
INSERT INTO doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES
  ('yarn_sale',    'YS', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true),
  ('general_sale', 'GS', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true),
  ('credit_note',  'CN', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true),
  ('debit_note',   'DN', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true)
ON CONFLICT (doc_type) DO NOTHING;

-- ── Auto-numbering trigger keyed off doc_type ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_invoice_auto_no() RETURNS trigger AS $$
BEGIN
  IF NEW.invoice_no IS NULL OR length(trim(NEW.invoice_no)) = 0 THEN
    NEW.invoice_no := fn_next_doc_no(
      CASE NEW.doc_type
        WHEN 'tax_invoice' THEN 'invoice'        -- keeps existing INV series
        ELSE NEW.doc_type::text                  -- yarn_sale, etc.
      END
    );
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_auto_no ON invoice;
CREATE TRIGGER trg_invoice_auto_no
  BEFORE INSERT ON invoice
  FOR EACH ROW EXECUTE FUNCTION fn_invoice_auto_no();

COMMIT;
