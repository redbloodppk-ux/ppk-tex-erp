-- 254_payment_stream.sql
--
-- A party can hold several balances with us at once. BMPT TEXTILES is a
-- customer, a jobwork party AND a yarn supplier. Each capacity is a
-- separate running account - a "stream" - and they must not net
-- silently. See app/lib/party-streams.ts and
-- docs/superpowers/specs/2026-08-20-party-stream-separation-design.md
--
-- A payment must record which stream it belongs to. Allocations imply it
-- for settled payments, but an ON-ACCOUNT ADVANCE has no allocations and
-- cannot be inferred, so the column is required.
--
-- contra_group_id links the two halves of an agreed offset between a
-- receivable stream and a payable stream: two payment rows, mode='contra',
-- mode_ledger_id NULL. No cash moves and every existing balance trigger
-- keeps working unchanged.
--
-- BACKFILL VERIFIED 2026-08-20 (dry run before applying):
--   154 payments; 147 resolved from allocations across all eight
--   allocation tables; 0 allocating across two streams; 7 unallocated
--   falling back on direction.
--   Resulting spread: in/customer 102, in/jobwork 12, out/supplier 40.
--   Simulated constraint violations: 0.

alter table payment
  add column if not exists stream          text not null default 'customer',
  add column if not exists contra_group_id uuid;

comment on column payment.stream is
  'Which party account this belongs to: customer | jobwork | outsource | supplier. Source of truth: app/lib/party-streams.ts';
comment on column payment.contra_group_id is
  'Links the two halves of a contra (agreed offset between streams). Both rows carry mode=''contra'' and no mode_ledger_id, so no cash moves.';

-- ── Backfill 1: take the stream of the allocated bill ────────────────
-- Only where every allocation on the payment agrees, so an ambiguous
-- payment is left on the default and surfaces in the check below rather
-- than being silently guessed at.
with alloc as (
  select pa.payment_id,
         case when i.doc_type::text = 'jobwork_invoice' then 'jobwork'
              when i.doc_type::text = 'weaving_bill'    then 'outsource'
              else 'customer' end as stream
  from payment_allocation pa
  join invoice i on i.id = pa.invoice_id
  union all
  select poa.payment_id,
         case when ol.direction = 'receivable' then 'customer' else 'supplier' end
  from payment_opening_allocation poa
  join party_opening_ledger ol on ol.id = poa.opening_ledger_id
  union all select payment_id, 'supplier' from payment_yarn_allocation
  union all select payment_id, 'supplier' from payment_bobbin_allocation
  union all select payment_id, 'supplier' from payment_sizing_allocation
  union all select payment_id, 'supplier' from payment_fabric_allocation
  union all select payment_id, 'supplier' from payment_warp_beam_allocation
  union all select payment_id, 'supplier' from payment_agent_allocation
),
one as (
  select payment_id, min(stream) as stream
  from alloc
  group by payment_id
  having count(distinct stream) = 1
)
update payment p
set stream = one.stream
from one
where one.payment_id = p.id;

-- ── Backfill 2: unallocated payments fall back on direction ──────────
update payment p
set stream = case when p.direction::text = 'in' then 'customer' else 'supplier' end
where not exists (select 1 from payment_allocation            a where a.payment_id = p.id)
  and not exists (select 1 from payment_opening_allocation    a where a.payment_id = p.id)
  and not exists (select 1 from payment_yarn_allocation       a where a.payment_id = p.id)
  and not exists (select 1 from payment_bobbin_allocation     a where a.payment_id = p.id)
  and not exists (select 1 from payment_sizing_allocation     a where a.payment_id = p.id)
  and not exists (select 1 from payment_fabric_allocation     a where a.payment_id = p.id)
  and not exists (select 1 from payment_warp_beam_allocation  a where a.payment_id = p.id)
  and not exists (select 1 from payment_agent_allocation      a where a.payment_id = p.id);

-- ── Constraints ──────────────────────────────────────────────────────
alter table payment
  drop constraint if exists payment_stream_valid;
alter table payment
  add constraint payment_stream_valid
  check (stream in ('customer', 'jobwork', 'outsource', 'supplier'));

-- Direction and stream must agree. Contra rows are exempt: the whole
-- point is that one half is 'out' on a payable stream and the other 'in'
-- on a receivable stream.
alter table payment
  drop constraint if exists payment_stream_direction_agree;
alter table payment
  add constraint payment_stream_direction_agree
  check (
    mode = 'contra'
    or (direction::text = 'in'  and stream in ('customer', 'jobwork'))
    or (direction::text = 'out' and stream in ('outsource', 'supplier'))
  );

create index if not exists idx_payment_party_stream
  on payment (party_id, stream);
create index if not exists idx_payment_contra_group
  on payment (contra_group_id) where contra_group_id is not null;
