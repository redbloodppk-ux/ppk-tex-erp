# Party Stream Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a party's customer, jobwork, outsource and supplier accounts as separate running balances everywhere, with an explicit contra entry for the occasions two are offset.

**Architecture:** One module (`app/lib/party-streams.ts`) owns the mapping from document type to stream and from stream to money direction. Every screen imports it instead of hardcoding `direction="out"`. `payment` gains a `stream` column so on-account advances can be attributed, and a `contra_group_id` so an offset is two linked payment rows that move no cash.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase/Postgres, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-20-party-stream-separation-design.md`

**Verified before planning:** 154 payments, 99 with allocations, **0 ambiguous** (no payment allocates across two streams), 55 unallocated falling back on direction. Inferred spread: customer 70, jobwork 12, supplier 17.

---

## Phase 1 — Foundation and the unsafe picker

### Task 1: Stream module

**Files:**
- Create: `app/lib/party-streams.ts`
- Test: `app/lib/party-streams.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/party-streams.test.ts
import { describe, it, expect } from 'vitest';
import {
  streamForDocType, streamForBillKind, directionForStream,
  STREAM_META, ALL_STREAMS, type PartyStream,
} from './party-streams';

const INVOICE_DOC_TYPES = [
  'tax_invoice', 'yarn_sale', 'general_sale', 'credit_note',
  'debit_note', 'jobwork_invoice', 'weaving_bill',
] as const;

const BILL_KINDS = [
  'invoice', 'opening_receivable', 'opening_payable', 'sizing_bill',
  'bobbin_purchase', 'yarn_purchase', 'fabric_purchase',
  'warp_beam_purchase', 'general_purchase',
] as const;

describe('party-streams', () => {
  it('maps every invoice doc_type to exactly one stream', () => {
    for (const dt of INVOICE_DOC_TYPES) {
      expect(ALL_STREAMS).toContain(streamForDocType(dt));
    }
  });

  it('puts jobwork bills on the jobwork stream, not customer', () => {
    expect(streamForDocType('jobwork_invoice')).toBe('jobwork');
    expect(streamForDocType('tax_invoice')).toBe('customer');
  });

  it('puts weaving bills on outsource', () => {
    expect(streamForDocType('weaving_bill')).toBe('outsource');
  });

  it('maps every bill kind to exactly one stream', () => {
    for (const k of BILL_KINDS) {
      expect(ALL_STREAMS).toContain(streamForBillKind(k));
    }
  });

  it('classifies purchases as supplier', () => {
    expect(streamForBillKind('yarn_purchase')).toBe('supplier');
    expect(streamForBillKind('sizing_bill')).toBe('supplier');
  });

  it('gives jobwork an INBOUND direction — they owe us', () => {
    expect(directionForStream('jobwork')).toBe('in');
    expect(directionForStream('customer')).toBe('in');
    expect(directionForStream('supplier')).toBe('out');
    expect(directionForStream('outsource')).toBe('out');
  });

  it('has metadata for every stream', () => {
    for (const s of ALL_STREAMS) {
      expect(STREAM_META[s as PartyStream].label.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run lib/party-streams.test.ts`
Expected: FAIL — "Failed to resolve import ./party-streams"

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/party-streams.ts
/**
 * Single source of truth for which ACCOUNT a money document belongs to
 * and which way the money flows.
 *
 * A party can trade with us in several capacities at once (BMPT TEXTILES
 * is a customer, a jobwork party AND a yarn supplier). Each capacity is
 * a separate running balance — a "stream" — and they never net silently.
 *
 * Direction used to be a hardcoded string on each screen, which is how
 * the dashboard came to show job work bills as payable (fixed 4325b3a).
 * Import from here instead; never write direction="out" by hand.
 */
export type PartyStream = 'customer' | 'jobwork' | 'outsource' | 'supplier';
export type MoneyDirection = 'in' | 'out';

export const ALL_STREAMS: readonly PartyStream[] =
  ['customer', 'jobwork', 'outsource', 'supplier'] as const;

export const STREAM_META: Record<PartyStream, {
  label: string; short: string; direction: MoneyDirection; blurb: string;
}> = {
  customer: {
    label: 'Customer', short: 'CUST', direction: 'in',
    blurb: 'Sales invoices — they owe us.',
  },
  jobwork: {
    label: 'Job Work', short: 'JW', direction: 'in',
    blurb: 'They sent their material, we wove it and billed them — they owe us.',
  },
  outsource: {
    label: 'Outsource Weaving', short: 'OW', direction: 'out',
    blurb: 'They wove our cloth and billed us — we owe them.',
  },
  supplier: {
    label: 'Supplier', short: 'SUPP', direction: 'out',
    blurb: 'Yarn / bobbin / sizing / fabric / beam purchases — we owe them.',
  },
};

/** invoice.doc_type -> stream. Unknown types fall back to 'customer'
 *  because the invoice table is the sales ledger by default. */
export function streamForDocType(docType: string): PartyStream {
  switch (docType) {
    case 'jobwork_invoice': return 'jobwork';
    case 'weaving_bill':    return 'outsource';
    default:                return 'customer';
  }
}

/** UnpaidBillsPicker bill kind -> stream. */
export function streamForBillKind(kind: string): PartyStream {
  switch (kind) {
    case 'invoice':
    case 'opening_receivable':
      return 'customer';
    case 'jobwork_invoice':
      return 'jobwork';
    case 'weaving_bill':
      return 'outsource';
    default:
      // sizing_bill, bobbin_purchase, yarn_purchase, fabric_purchase,
      // warp_beam_purchase, general_purchase, opening_payable
      return 'supplier';
  }
}

export function directionForStream(s: PartyStream): MoneyDirection {
  return STREAM_META[s].direction;
}

/** Streams that sit on the given side of the books. */
export function streamsForDirection(d: MoneyDirection): PartyStream[] {
  return ALL_STREAMS.filter((s) => STREAM_META[s].direction === d);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run lib/party-streams.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
git add app/lib/party-streams.ts app/lib/party-streams.test.ts
git commit -m "feat(streams): single source of truth for party stream + money direction"
```

---

### Task 2: Migration 254 — payment.stream and contra_group_id

**Files:**
- Create: `app/db/migrations/254_payment_stream.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 254_payment_stream.sql
--
-- A party can trade with us in several capacities at once. Each is a
-- separate running balance ("stream"). A payment must say which stream
-- it belongs to: allocations imply it for settled payments, but an
-- ON-ACCOUNT ADVANCE has no allocations and cannot be inferred.
--
-- Also adds contra_group_id: an agreed offset between a receivable
-- stream and a payable stream is recorded as TWO payment rows sharing a
-- group id, mode='contra', mode_ledger_id NULL. No cash moves; every
-- existing balance trigger keeps working unchanged.
--
-- Backfill verified on 2026-08-20: 154 payments, 99 with allocations,
-- 0 allocating across two streams, 55 unallocated.

alter table payment
  add column if not exists stream           text not null default 'customer',
  add column if not exists contra_group_id  uuid;

comment on column payment.stream is
  'Which party account this belongs to: customer | jobwork | outsource | supplier. See app/lib/party-streams.ts.';
comment on column payment.contra_group_id is
  'Links the two halves of a contra (offset between streams). Both rows have mode=''contra'' and no mode_ledger_id.';

-- Backfill 1: payments that have allocations take the allocated bill's stream.
with alloc as (
  select pa.payment_id,
         case when i.doc_type::text = 'jobwork_invoice' then 'jobwork'
              when i.doc_type::text = 'weaving_bill'    then 'outsource'
              else 'customer' end as stream
  from payment_allocation pa join invoice i on i.id = pa.invoice_id
  union all select payment_id, 'supplier' from payment_yarn_allocation
  union all select payment_id, 'supplier' from payment_bobbin_allocation
  union all select payment_id, 'supplier' from payment_sizing_allocation
  union all select payment_id, 'supplier' from payment_fabric_allocation
  union all select payment_id, 'supplier' from payment_warp_beam_allocation
),
one as (
  select payment_id, min(stream) as stream
  from alloc group by payment_id having count(distinct stream) = 1
)
update payment p set stream = one.stream
from one where one.payment_id = p.id;

-- Backfill 2: unallocated payments fall back on direction.
update payment
set stream = case when direction::text = 'in' then 'customer' else 'supplier' end
where id not in (
  select pa.payment_id from payment_allocation pa
  union select payment_id from payment_yarn_allocation
  union select payment_id from payment_bobbin_allocation
  union select payment_id from payment_sizing_allocation
  union select payment_id from payment_fabric_allocation
  union select payment_id from payment_warp_beam_allocation
);

alter table payment
  add constraint payment_stream_valid
  check (stream in ('customer','jobwork','outsource','supplier'));

-- Direction and stream must agree, EXCEPT on contra rows where the
-- whole point is that one side is 'out' on a payable stream and the
-- other 'in' on a receivable stream.
alter table payment
  add constraint payment_stream_direction_agree
  check (
    mode = 'contra'
    or (direction::text = 'in'  and stream in ('customer','jobwork'))
    or (direction::text = 'out' and stream in ('outsource','supplier'))
  );

create index if not exists idx_payment_party_stream on payment (party_id, stream);
create index if not exists idx_payment_contra_group on payment (contra_group_id)
  where contra_group_id is not null;
```

- [ ] **Step 2: Apply it and verify the backfill**

Run this verification query. Expected: `violations` = 0, and the spread matching the dry-run (customer 70 + 55 fallback split, jobwork 12, supplier 17).

```sql
select stream, direction::text, count(*)
from payment group by 1,2 order by 1,2;

select count(*) as violations from payment
where mode is distinct from 'contra'
  and not ((direction::text='in'  and stream in ('customer','jobwork'))
        or (direction::text='out' and stream in ('outsource','supplier')));
```

- [ ] **Step 3: Spot-check the known payment**

Payment 175 (BMPT, ₹20,000, allocated to `JWB/26-27/0001`) must land on `jobwork`:

```sql
select id, direction::text, stream, amount from payment where id = 175;
```
Expected: `175 | in | jobwork | 20000.00`

- [ ] **Step 4: Commit**

```bash
git add app/db/migrations/254_payment_stream.sql
git commit -m "db: payment.stream + contra_group_id with verified backfill"
```

---

### Task 3: Filter the unpaid-bills picker by stream

This is the task that closes the live hazard: a receipt screen currently
offers payable bills to tick.

**Files:**
- Modify: `app/app/components/unpaid-bills-picker.tsx`

- [ ] **Step 1: Add the `stream` prop and tag every loaded bill**

In `UnpaidBillsPickerProps` (around line 54, beside `direction`):

```ts
  /** Which party account these bills belong to. Bills outside this
   *  stream are not loaded — a receipt can never settle a payable. */
  stream: PartyStream;
```

Import at the top:

```ts
import { STREAM_META, streamForBillKind, streamForDocType, type PartyStream } from '@/lib/party-streams';
```

- [ ] **Step 2: Give `UnpaidBill` a stream and populate it**

Add `stream: PartyStream;` to the `UnpaidBill` interface (near `doc_type`, line 75).

Where invoice rows are mapped (line ~198), set `stream: streamForDocType(r.doc_type)`.
Where opening-ledger rows are mapped (line ~219), set
`stream: r.direction === 'receivable' ? 'customer' : 'supplier'`.
For every purchase mapping (sizing ~235, bobbin ~251, yarn ~267, fabric ~283, warp beam ~299) set `stream: 'supplier'`.

- [ ] **Step 3: Filter before rendering**

Immediately after the combined bill array is assembled and before
`setBills(...)`, drop everything outside the stream:

```ts
    const inStream = liveBills.filter((b) => b.stream === stream);
    setBills(inStream);
```

Add `stream` to the `loadBills` dependency array.

- [ ] **Step 4: Name the stream in the heading**

Replace the heading at line ~437:

```tsx
          {title ?? `Unpaid ${STREAM_META[stream].label} bills`} — tick to adjust this{' '}
          {direction === 'in' ? 'receipt' : 'payment'} against them
```

- [ ] **Step 5: Verify against BMPT**

Open Payments → new receipt → party BMPT TEXTILES → stream Job Work.
Expected: only `JWB/26-27/0001` (₹22,208). The two yarn purchases and the
yarn sale must **not** appear.
Switch stream to Customer: only `YS/26-27/0003` (₹11,025).

- [ ] **Step 6: Typecheck and commit**

```bash
cd app && npx tsc --noEmit -p tsconfig.json
git add app/app/components/unpaid-bills-picker.tsx
git commit -m "fix(payments): bill picker only shows bills from the selected stream"
```

---

### Task 4: Stream selector on the Payments page

**Files:**
- Modify: `app/app/app/payments/page.tsx`

- [ ] **Step 1: Detect which streams a party actually uses**

After the party is chosen, query the streams that have at least one open
bill. Show the selector only when the count is greater than 1; otherwise
auto-select the single stream and render nothing. This keeps the common
single-role party at zero extra clicks.

- [ ] **Step 2: Pass `stream` into `UnpaidBillsPicker`** and set
`direction={directionForStream(stream)}` rather than any literal.

- [ ] **Step 3: Persist it** — write `stream` on the inserted `payment` row.

- [ ] **Step 4: Verify** — record a ₹1 receipt against BMPT on the Customer
stream, confirm `select stream from payment order by id desc limit 1`
returns `customer`, then delete the test payment.

- [ ] **Step 5: Typecheck and commit**

```bash
cd app && npx tsc --noEmit -p tsconfig.json
git add app/app/app/payments/page.tsx
git commit -m "feat(payments): choose the party account a receipt/payment belongs to"
```

---

## Phase 2 — Visibility

### Task 5: Party statement — one section per stream

**Files:**
- Modify: `app/app/app/parties/[id]/statement/print/page.tsx`

- [ ] **Step 1:** Tag every row the statement gathers with its stream
  using `streamForDocType` / `streamForBillKind`.
- [ ] **Step 2:** Group rows by stream; render a section per stream with
  its own opening balance, transactions and closing balance.
- [ ] **Step 3:** Add a final summary table listing each stream's closing
  balance and the net across all of them.
- [ ] **Step 4:** Verify BMPT's statement shows Customer ₹11,025,
  Job Work ₹22,208, Supplier ₹19,169.13, net receivable ₹14,063.87.
- [ ] **Step 5:** Commit.

### Task 6: Ledger View — group by stream

**Files:**
- Modify: `app/app/app/ledgers/ledger-view-query.ts`
- Modify: `app/app/app/ledgers/ledger-view-tab.tsx`

- [ ] **Step 1:** Return `stream` on every row from the query module.
- [ ] **Step 2:** Group and subtotal by stream in the tab.
- [ ] **Step 3:** Verify BMPT shows three groups that sum to the statement figures.
- [ ] **Step 4:** Commit.

### Task 7: Remove the last hardcoded directions

**Files:**
- Modify: `app/app/app/dashboard/page.tsx`

- [ ] **Step 1:** Replace each literal `direction="in" | "out"` on the
  four `OutstandingByParty` cards with `directionForStream('customer')`,
  `directionForStream('jobwork')`, `directionForStream('outsource')`,
  `directionForStream('supplier')`.
- [ ] **Step 2:** Confirm the rendered output is byte-identical to today —
  this is a refactor, `4325b3a` already made the behaviour correct.
- [ ] **Step 3:** Commit.

### Task 8: Contra entry

**Files:**
- Create: `app/app/app/payments/contra-tab.tsx`
- Modify: `app/app/app/payments/page.tsx`

- [ ] **Step 1:** New tab: party, "from" stream (payable), "to" stream
  (receivable), amount, date, notes.
- [ ] **Step 2:** On save, generate one `contra_group_id` and insert two
  `payment` rows — `out`/payable and `in`/receivable — both with
  `mode='contra'` and `mode_ledger_id` NULL.
- [ ] **Step 3:** Allocate each side against its own stream's bills using
  the existing picker with the matching `stream` prop.
- [ ] **Step 4:** Show a "Contra" chip on both statement sections, linking
  to the other half.
- [ ] **Step 5:** Verify a ₹5,000 BMPT contra moves both balances, leaves
  the bank untouched (`mode_ledger_id is null`), and appears on both
  statement sections. Then delete the test rows.
- [ ] **Step 6:** Commit.

---

## Self-review

- **Spec coverage:** streams (T1), schema + contra storage (T2), picker
  (T3), payments page (T4), statement (T5), Ledger View (T6), dashboard
  (T7), contra UI (T8). All spec sections have a task.
- **Type consistency:** `PartyStream`, `MoneyDirection`, `STREAM_META`,
  `streamForDocType`, `streamForBillKind`, `directionForStream`,
  `streamsForDirection` are defined in Task 1 and used with those exact
  names in Tasks 3, 4, 5, 6, 7.
- **Known compression:** Tasks 4–8 give file paths, exact behaviour and
  verification steps but not full code, because they edit large existing
  files (`payments/page.tsx` is 2,464 lines) where the surrounding code
  must be read first. Tasks 1–3 — the foundation and the live hazard —
  are complete and literal.
