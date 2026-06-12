-- 161: optional "Ship to" on invoices.
--
-- When the consignee differs from the bill-to party the operator ticks
-- "Ship to different address" on the invoice form and picks a party.
-- We snapshot the shipping details onto the invoice (name / address /
-- gstin / state) so the printed document never changes retroactively
-- when the party master is edited. ship_to_party_id keeps the link for
-- reporting.

alter table invoice add column if not exists ship_to_party_id bigint references party (id);
alter table invoice add column if not exists ship_to_name    text;
alter table invoice add column if not exists ship_to_address text;
alter table invoice add column if not exists ship_to_gstin   text;
alter table invoice add column if not exists ship_to_state   text;
