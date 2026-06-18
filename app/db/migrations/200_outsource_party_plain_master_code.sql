-- 200_outsource_party_plain_master_code.sql
--
-- Outsource Weaver is a party/master record, so its code must accumulate
-- forever (OWP-0001, OWP-0002, ...) like every other party type — not carry a
-- {fy} segment and reset each financial year. Switch the sequence to the plain
-- master format and disable the yearly reset. No OWP-prefixed codes exist yet,
-- so next_value stays at 1.

UPDATE public.doc_sequence
   SET format = '{prefix}-{seq:0000}',
       reset_yearly = false,
       fy_code = ''
 WHERE doc_type = 'outsource_party';
