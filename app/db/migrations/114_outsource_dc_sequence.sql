-- 114_outsource_dc_sequence.sql
--
-- The Delivery Challan form gains a third production mode "outsource"
-- for goods sent to outsource weavers. Outsource DCs need their own
-- voucher prefix so they don't share a numbering pool with either
-- in-house sales DCs (DC/26-27/NNNN) or jobwork DCs (JDC/26-27/NNNN).
--
-- Use ODC as the prefix.
--
-- The legacy delivery_challan.production_mode column is `text`, so no
-- enum migration is needed — the new form just writes 'outsource' as
-- the string value.

BEGIN;

INSERT INTO public.doc_sequence (doc_type, prefix, format, next_value, fy_code)
VALUES ('outsource_dc', 'ODC', '{prefix}/{fy}/{seq:0000}', 1, '26-27')
ON CONFLICT (doc_type) DO NOTHING;

COMMIT;
