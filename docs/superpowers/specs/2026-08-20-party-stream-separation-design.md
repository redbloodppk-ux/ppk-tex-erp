# Party Stream Separation — Design Spec

**Date:** 2026-08-20
**Status:** Approved (owner decisions recorded below)

## Problem

A party can trade with us in several capacities at once. BMPT TEXTILES is
simultaneously a customer, a jobwork party, and a yarn supplier:

| Document | Amount | Who owes whom |
|---|---|---|
| `YS/26-27/0003` yarn sale | 11,025.00 | they owe us |
| `JWB/26-27/0001` jobwork bill | 22,208.00 | they owe us |
| `06/2026-27` yarn purchase | 7,451.13 | we owe them |
| `09/2026-27` yarn purchase | 11,718.00 | we owe them |

Today every screen keys purely on `party_id`, so all four merge into one
running account. Three concrete consequences:

1. **`unpaid-bills-picker.tsx` shows payables on the receipt screen.**
   The `direction` prop is used in exactly one place (line 437) — to pick
   the word "receipt" or "payment" in the heading. It never filters the
   list. Ticking a yarn purchase while recording a receipt marks a
   supplier bill paid when no money left the bank.
2. **The party statement and Ledger View net everything together**, so
   there is no way to see what BMPT owes us *as a jobwork party*.
3. **Ledger masters exist but are inert.** 210 `ledger` rows are
   auto-created by migration 121; 0 of 94 invoices and 0 of 154 payments
   carry a `ledger_id`. `LED-0198 BMPT TEXTILES` is even grouped under
   SUNDRY CREDITORS though the jobwork balance is receivable.

Affected parties today: BMPT (customer + jobwork + supplier),
GUNA TEXTILES (customer + supplier), SHREE VARUNAMBIGAI TEX (two supplier
kinds). Small blast radius — the right time to fix the model.

## Owner decisions

- **Netting:** *"Sometimes, by agreement."* Streams are settled
  independently by default, but an explicit, auditable contra entry must
  exist for the occasions the two are offset.
- **Depth:** *Separate balances everywhere* — statement, Ledger View,
  dashboard cards, and the receipt/payment bill picker.

## Model

### Streams

Every money document belongs to exactly one **stream** per party:

| Stream | Natural direction | Sources |
|---|---|---|
| `customer` | receivable (in) | `invoice` doc_types `tax_invoice`, `yarn_sale`, `general_sale`, `credit_note`, `debit_note`; `party_opening_ledger` direction `receivable` |
| `jobwork` | receivable (in) | `invoice` doc_type `jobwork_invoice` |
| `outsource` | payable (out) | `invoice` doc_type `weaving_bill` |
| `supplier` | payable (out) | `yarn_lot`, `bobbin_purchase`, `sizing_job`, `fabric_purchase`, `inhouse_warp_beam_purchase`, `general_purchase`; `party_opening_ledger` direction `payable` |

`customer` and `jobwork` are both receivable but remain **separate
accounts** — that is the whole point of this change. Direction alone is
not sufficient to tell them apart.

### Single source of truth

The root cause of both this problem and the dashboard bug fixed in
`4325b3a` is that direction is decided ad hoc, per screen, as a
hardcoded string. One module owns the mapping and every screen imports
it:

```ts
// app/lib/party-streams.ts
export type PartyStream = 'customer' | 'jobwork' | 'outsource' | 'supplier';
export type MoneyDirection = 'in' | 'out';

export const STREAM_META: Record<PartyStream, {
  label: string;
  direction: MoneyDirection;   // 'in' = they owe us
  short: string;
}> = {
  customer:  { label: 'Customer',        direction: 'in',  short: 'CUST' },
  jobwork:   { label: 'Job Work',        direction: 'in',  short: 'JW'   },
  outsource: { label: 'Outsource Weaving', direction: 'out', short: 'OW' },
  supplier:  { label: 'Supplier',        direction: 'out', short: 'SUPP' },
};

export function streamForDocType(docType: string): PartyStream { /* … */ }
export function streamForBillKind(kind: string): PartyStream { /* … */ }
export function directionForStream(s: PartyStream): MoneyDirection {
  return STREAM_META[s].direction;
}
```

No screen may hardcode `direction="out"` again. A unit test asserts every
known `doc_type` and bill `kind` maps to exactly one stream, so adding a
document type without classifying it fails the build.

### Schema changes (migration 254)

`payment` gains:

- `stream text not null default 'customer'` — which account this receipt
  or payment belongs to. Required because an **on-account advance** has
  no allocations to infer the stream from.
- `contra_group_id uuid null` — links the two halves of a contra.

Backfill for the existing 154 payments, in priority order:

1. If the payment has allocations, take the stream of the first
   allocated bill.
2. Otherwise fall back on direction: `in` → `customer`, `out` →
   `supplier`.

A CHECK constraint keeps `stream` and `direction` consistent:
`direction = 'in'` requires stream in (`customer`, `jobwork`);
`direction = 'out'` requires stream in (`outsource`, `supplier`).
Contra rows are exempt (see below).

### Contra entries

A contra offsets a receivable stream against a payable stream for the
same party. No cash moves. It is recorded as **two `payment` rows**
sharing a `contra_group_id`:

| | row A | row B |
|---|---|---|
| direction | `in` | `out` |
| stream | `jobwork` | `supplier` |
| amount | equal | equal |
| `mode` | `contra` | `contra` |
| `mode_ledger_id` | NULL | NULL |

Both rows allocate to bills exactly as a normal payment does, so every
existing balance trigger keeps working untouched. `mode_ledger_id` is
NULL, so the bank book is unaffected. Both statements show the offset
with a "Contra" label and a link to the other half.

The CHECK constraint above is relaxed for rows where `mode = 'contra'`.

## Screen behaviour

| Screen | Change |
|---|---|
| `unpaid-bills-picker.tsx` | Accept a required `stream` prop. Load and show only bills belonging to that stream. Heading names the stream, e.g. "Unpaid Job Work bills". |
| Payments page | Add a stream selector shown only when the chosen party has more than one active stream. For single-stream parties it is auto-selected and hidden — no extra clicks for the 95% case. |
| Contra entry | New tab on the Payments page: pick party, pick the two streams, amount, then allocate each side against its own bills. |
| Party statement print | One section per stream, each with its own opening balance, transactions and closing balance, then a combined summary line. |
| Ledger View | Group rows by stream with a subtotal per stream. Existing filters unchanged. |
| Dashboard | Replace the remaining hardcoded `direction=` strings with `directionForStream(...)`. Behaviour is already correct after `4325b3a`; this removes the ability to regress. |

## Out of scope

Wiring the 210 `ledger` master records into real double-entry posting.
That is a larger project and needs the `LED-0198` SUNDRY CREDITORS
misclassification resolved first. This spec gives logical separation by
stream; it does not make the chart of accounts live. Recorded as a
follow-up.

## Risks

- **Backfill mis-assigns an old payment.** Mitigated by a verification
  query comparing every payment's inferred stream against its
  allocations, run before and after; any payment whose allocations span
  two streams is listed for manual review rather than guessed at.
- **A stream-filtered picker hides a bill someone used to settle
  cross-stream.** That is the behaviour being removed on purpose; the
  contra tab is the supported replacement.
