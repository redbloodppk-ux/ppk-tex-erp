-- 198_master_code_sequences_no_yearly_reset.sql
--
-- Master-record code sequences carry no {fy} token in their format, so their
-- codes are meant to accumulate forever (PRT-0001, PRT-0002, ...) and must
-- never reset per financial year.
--
-- They had been seeded with reset_yearly = true. fn_next_doc_no() resets the
-- counter to 1 whenever the stored fy_code differs from the current financial
-- year — so the first call after the stored fy_code went stale (it was '')
-- re-issued PRT-0001, which already exists, raising:
--     duplicate key value violates unique constraint "party_code_key"
--
-- The next_value on each row is already correct (= highest existing code + 1);
-- we only need to stop the yearly reset.

UPDATE public.doc_sequence
   SET reset_yearly = false
 WHERE doc_type IN ('party', 'party_type', 'jobwork_party', 'fabric_type', 'costing');
