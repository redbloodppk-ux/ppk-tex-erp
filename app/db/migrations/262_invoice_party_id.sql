-- 262_invoice_party_id.sql
--
-- Audit item 6, first half. Gives `invoice` a real foreign key to `party`.
--
-- THE PROBLEM
-- Invoices are matched to parties by TEXT. Seven places in the codebase do
--   .ilike('party_name', party.name)
-- including the shared bill loader added earlier today. It works only
-- because all 192 party names happen to be unique right now.
--
-- The failure mode is silent: rename a party and every invoice of theirs
-- stops matching. No error, no warning - outstanding balances, statements
-- and the Payments bill picker simply show less than they should. Nothing
-- in the system would flag it.
--
-- THE FIX
-- Add invoice.party_id as a proper FK and use it for LOOKUPS.
--
-- party_name is deliberately KEPT and still written. It is the name
-- printed on the document at the time it was issued - a historical
-- record, not a link. Dropping it would rewrite past invoices whenever a
-- party is renamed, which is the opposite of what we want. So:
--   party_id    - the link (stable, survives renames)
--   party_name  - the printed name (frozen, never re-derived)
--
-- BACKFILL SAFETY (verified before applying)
--   94 invoices; 0 with no party_name; 0 needing trim;
--   94 resolve to EXACTLY ONE party; 0 unmatched; 0 ambiguous.
--
-- Snapshot taken immediately before (auto_backup id 8).
--
-- NOT DONE HERE: retiring the `customer` table. Only 4 tables reference it
-- (invoice, sales_order, payment, bobbin_stock) and just 90 rows use it -
-- but 6 views depend on it, so that is a separate piece of work.

alter table invoice
  add column if not exists party_id bigint references party(id);

comment on column invoice.party_id is
  'FK to party - the stable link. Use this for lookups, never match on '
  'party_name. party_name is the name PRINTED on the document when it was '
  'issued and is deliberately frozen. See migration 262.';

-- Backfill by exact, case-insensitive, trimmed name.
update invoice i
set party_id = p.id
from party p
where i.party_id is null
  and i.party_name is not null
  and upper(trim(i.party_name)) = upper(p.name);

create index if not exists idx_invoice_party_id on invoice (party_id);

-- Verified after applying: 94 of 94 invoices carry a party_id, and every
-- one resolves to the same party the old ilike match would have found.
