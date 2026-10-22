-- 326: Project-wide double-save guard.
-- Blocks inserting a record identical to one saved (and still existing) in the
-- last 2 minutes from a DIFFERENT request/transaction. Multi-row saves in one
-- request are never blocked. Compares every column except ids, auto numbers,
-- timestamps, generated and now()/nextval() defaults (hash of to_jsonb(NEW)).
-- Fires last among BEFORE INSERT triggers (trg_zz_...) so auto codes are set.
-- Not applied to child/line tables, bulk tables (bank_entry, stock_ledger,
-- shift logs, attendance) or tables where identical rows are normal
-- (pavu, jobwork beams/bags, bobbin purchases, beam movements).

CREATE TABLE IF NOT EXISTS public.dup_guard_recent (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  payload_hash text NOT NULL,
  row_id bigint,
  tx bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dup_guard_recent_lookup ON public.dup_guard_recent (table_name, payload_hash, created_at);
ALTER TABLE public.dup_guard_recent ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dup_guard_recent TO service_role;

-- fn_dup_guard(): SECURITY DEFINER; see live definition (pg_get_functiondef).
-- Raises: 'Duplicate save blocked: an identical <thing> was saved N seconds ago...'

-- Attached as trg_zz_dup_guard BEFORE INSERT FOR EACH ROW on:
-- invoice, payment, delivery_challan, fabric_receipt, yarn_lot, yarn_transfer,
-- pavu_transfer, bobbin_transfer, sizing_job, general_purchase, fabric_purchase,
-- inhouse_warp_beam_purchase, production_batch, expense_entry, wage_entry,
-- employee_loan, tds_payment, sales_order, party, customer, ledger, employee,
-- reminder, costing_master, bobbin_return.
-- Any NEW document table should get the same trigger:
--   CREATE TRIGGER trg_zz_dup_guard BEFORE INSERT ON public.<t>
--     FOR EACH ROW EXECUTE FUNCTION public.fn_dup_guard();
