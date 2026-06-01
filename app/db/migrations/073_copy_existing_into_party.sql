-- 073_copy_existing_into_party.sql
--
-- Backfill: copy every existing customer / mill / jobwork_party row into
-- the new unified `party` table so the Parties page actually shows all
-- the businesses you've already entered. We preserve the original code
-- (CUST-NNNN / MILL-NNN / JWP-NNNN) on the party row so the operator
-- still recognises them.
--
-- The party.ledger_id link is taken from the source row when it already
-- has one (customer + mill have auto-ledger via migration 058); otherwise
-- the BEFORE INSERT trigger from migration 072 takes care of it.
--
-- Idempotent: re-running skips rows already present via ON CONFLICT.

BEGIN;

INSERT INTO public.party (
  code, party_type_id, name, contact_person, gstin, pan, phone, email,
  whatsapp, billing_address, shipping_address, city, state, pincode,
  payment_terms_days, credit_limit, is_vip, notes, status, ledger_id
)
SELECT c.code,
       (SELECT id FROM public.party_type_master WHERE name = 'Customer'),
       c.name, c.contact_person, c.gstin, c.pan, c.phone, c.email,
       c.whatsapp, c.billing_address, c.shipping_address, c.city, c.state, c.pincode,
       c.payment_terms_days, c.credit_limit, c.is_vip, c.notes, c.status, c.ledger_id
FROM public.customer c
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.party (
  code, party_type_id, name, gstin, phone, email,
  billing_address, status, ledger_id
)
SELECT m.code,
       (SELECT id FROM public.party_type_master WHERE name = 'Mill / Yarn Supplier'),
       m.name, m.gstin, m.phone, m.email,
       COALESCE(m.address, ''), m.status, m.ledger_id
FROM public.mill m
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.party (
  code, party_type_id, name, contact_person, gstin, pan, phone, email,
  whatsapp, billing_address, shipping_address, city, state, pincode,
  payment_terms_days, credit_limit, notes, status
)
SELECT j.code,
       (SELECT id FROM public.party_type_master WHERE name = 'Jobwork Party'),
       j.name, j.contact_person, j.gstin, j.pan, j.phone, j.email,
       j.whatsapp, j.billing_address, j.shipping_address, j.city, j.state, j.pincode,
       j.payment_terms_days, j.credit_limit, j.notes, j.status
FROM public.jobwork_party j
ON CONFLICT (code) DO NOTHING;

COMMIT;
