-- 115_weaving_bill_sequence.sql
--
-- The "Weaving Bill" form (formerly Jobwork Bill) now serves BOTH
-- jobwork parties and outsource weavers. Up to now both flows shared
-- the same JB/26-27/NNNN sequence (doc_type='jobwork_invoice').
--
-- The owner wants outsource weaving bills numbered WB/26-27/NNNN so
-- they don't collide with in-house jobwork bills.
--
-- This migration:
--   1. Adds a new enum value 'weaving_bill' to invoice_doc_type.
--   2. Seeds a doc_sequence row for it with prefix WB.
--   3. Relaxes invoice_party_check so 'weaving_bill' also requires
--      jobwork_party_id (same shape as 'jobwork_invoice').
--   4. Updates fn_invoice_auto_no so it routes 'weaving_bill' to the
--      WB sequence (jobwork_invoice still routes to JB).
--
-- Run order: 115a must commit before 115b — Postgres allows ALTER TYPE
-- ADD VALUE inside a transaction, but the new enum literal can't be
-- USED (compared in a CHECK constraint or trigger body) until the txn
-- commits.

-- ╭─────────────────────────────────────────────────────────────────╮
-- │ 115a — enum + doc_sequence row                                   │
-- ╰─────────────────────────────────────────────────────────────────╯

ALTER TYPE invoice_doc_type ADD VALUE IF NOT EXISTS 'weaving_bill';

INSERT INTO public.doc_sequence (doc_type, prefix, format, fy_code, next_value, reset_yearly)
VALUES ('weaving_bill', 'WB', '{prefix}/{fy}/{seq:0000}', '26-27', 1, true)
ON CONFLICT (doc_type) DO NOTHING;
