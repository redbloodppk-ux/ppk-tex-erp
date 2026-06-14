# Fabric Stock + Credit Note → bill adjustment design

**Date:** 2026-06-14
**Status:** Approved by user, ready for implementation.

## Summary

Two flows in PPK TEX ERP today create money-side records (fabric purchase from a customer in lieu of payment, and sales-return credit notes) but don't surface those amounts in the unified Payments + Allocations machinery. This means the customer's bills don't auto-settle, the operator has to manually adjust amounts, and the Status tab on Payments doesn't show a row for the transaction.

This change extracts the existing bill-tick-and-adjust UI from `/app/payments` into a reusable component and drops it into:
1. **Fabric Stock** page — new "Customer adjustment" source mode where fabric received from a customer offsets their unpaid bills.
2. **Credit Note** flow in `/app/invoices/new` — new "Spread mode" where the credit can be split across multiple unpaid bills instead of always landing on the original invoice.

## Out of scope

- Debit-note / purchase-return adjustments. Same idea applies but the user explicitly asked only for Fabric Stock + Credit Note today.
- A separate "Adjustment Voucher" document type. We stay within the existing `payment` + `payment_allocation` schema.
- Changes to the supplier-purchase path on Fabric Stock. That stays exactly as it is today.

## User-visible flows

### Fabric Stock — Customer adjustment

1. Operator opens the Fabric Stock "Add Purchase" form.
2. New control at the top: **Source: ( ) Supplier purchase  ( ) Customer adjustment**.
3. Picking "Customer adjustment":
   - The party dropdown switches to customers (active parties with type = Customer). Type-ahead search is the existing `SearchSelect`.
   - Below the qty/rate/total inputs, the **UnpaidBillsPicker** appears, fetching this customer's unpaid invoices/opening-ledger rows.
   - If the customer has no unpaid bills, the picker shows: *"No unpaid bills. This fabric value will be recorded as advance credit to the customer."*
4. Operator ticks bills (allocation auto-spreads oldest first, just like Payments).
5. **Save** writes:
   - `fabric_purchase` row (existing).
   - Synthetic `payment` row: `direction='in'`, `mode='fabric_adjustment'`, `party_id`, `amount` = fabric total, `fabric_purchase_id` = link back.
   - One `payment_allocation` (or `payment_opening_allocation`) row per ticked bill.
   - If no bills ticked → payment row exists with no allocations, sitting as an advance.

### Credit Note — Spread mode

1. Operator opens `/app/invoices/new`, picks "Sales Return".
2. They pick a customer + the original invoice (existing required field — kept for GST paper trail).
3. New checkbox below: **☐ Spread the credit across multiple unpaid bills (instead of applying it all to the original invoice)**.
4. When unticked (default), behaviour is unchanged: credit applies to the original invoice.
5. When ticked: the **UnpaidBillsPicker** appears. Operator can include the original invoice plus any other unpaid bills of this customer.
6. **Save** writes:
   - Credit-note `invoice` row (existing).
   - Synthetic `payment` row: `direction='in'`, `mode='credit_note'`, `party_id`, `amount` = credit total, `invoice_id` = the credit note's id.
   - `payment_allocation` rows for ticked bills (or just one row against the original invoice when spread is off).

## Shared component — `UnpaidBillsPicker`

Location: `app/components/unpaid-bills-picker.tsx` (client component).

**Props:**
```ts
interface UnpaidBillsPickerProps {
  partyId: number | null;
  totalAmount: number;             // how much is being allocated
  direction: 'in' | 'out';         // tweaks the heading text
  onAllocationsChange(allocs: BillAllocation[]): void;
  showAdvanceHint?: boolean;       // default true
}

type BillAllocation =
  | { kind: 'invoice';  invoice_id: number;        amount: number }
  | { kind: 'opening';  opening_ledger_id: number; amount: number }
  | { kind: 'sizing';   sizing_job_id: number;     amount: number }
  | { kind: 'bobbin';   bobbin_purchase_id: number; amount: number }
  | { kind: 'yarn';     yarn_lot_id: number;       amount: number };
```

**Responsibilities:**
- Fetches unpaid bills for the party from the same 5 sources the Payments page uses today (invoice, party_opening_ledger, sizing_job, bobbin_purchase, yarn_lot).
- Renders the checkbox table with auto-spread + per-bill override inputs.
- Validates `sum(allocations) <= totalAmount` and exposes the running total for the parent to display.
- Emits allocations upward via `onAllocationsChange`. Parents do their own save calls — the component never writes to Supabase itself.

**Consumers:**
- `app/app/payments/page.tsx` — refactored to wrap the component (no behaviour change for end users).
- `app/components/fabric-purchase-log.tsx` — new Customer adjustment mode.
- `app/app/invoices/new/page.tsx` — credit_note Spread mode.

## Database

Migration **168 — `fabric_adjustment_credit_note_modes.sql`**:

```sql
-- payment.mode is a text column with no CHECK constraint today,
-- so the new values 'fabric_adjustment' and 'credit_note' are
-- accepted without a schema change. We still document them here
-- so the column dictionary is honest.
COMMENT ON COLUMN public.payment.mode IS
  'cash | bank_transfer | upi | cheque | fabric_adjustment | credit_note';

-- New optional FK from payment to fabric_purchase so the
-- synthetic adjustment row links back for audit (and so a
-- fabric_purchase delete cascades the synthetic payment).
ALTER TABLE public.payment
  ADD COLUMN IF NOT EXISTS fabric_purchase_id bigint
    REFERENCES public.fabric_purchase(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_payment_fabric_purchase_id
  ON public.payment (fabric_purchase_id) WHERE fabric_purchase_id IS NOT NULL;
```

No other schema changes. We reuse existing allocation tables (`payment_allocation`,
`payment_opening_allocation`, `payment_sizing_allocation`, `payment_bobbin_allocation`,
`payment_yarn_allocation`) and the triggers that keep `amount_paid` in sync.

## Error / edge handling

- **Picker fetch fails:** show inline error, keep Save disabled if the operator was relying on bill adjustment.
- **No unpaid bills:** picker shows the "advance credit" message. Save still works — payment row is created with no allocations.
- **Allocated > total:** save guard rejects with the same message the Payments page uses today: "Adjusted total ₹X is more than the amount ₹Y."
- **Bills ticked but allocation is partial** (i.e., ticked bills + leftover): same Payments-page behaviour — block save and tell operator to either fill the rest in or untick.
- **Backend errors after fabric_purchase is inserted:** the fabric row is created first; if the payment / allocation writes fail, we surface the error and leave the fabric row in place (operator can delete it manually). No transactions across HTTP round trips; documenting this trade-off.

## Testing

Manual smoke checklist (no E2E framework set up for this repo yet):

1. Fabric Stock supplier mode unchanged — old form still works end-to-end.
2. Customer adjustment with bills → fabric purchase saved, payment row appears in Status tab with mode "fabric_adjustment", ticked invoices flip to paid.
3. Customer adjustment with no bills → fabric purchase saved, payment row appears as advance on customer's running balance.
4. Credit note default (no spread) → original invoice marked paid by credit-note allocation; same as today's behaviour, but allocation now visible in Payments.
5. Credit note spread mode → credit value split across N bills, all flip to paid; original invoice can also be one of the N.
6. Payments page UI unchanged after refactor.

## File-change summary

```
app/
  app/
    app/
      payments/page.tsx                 # refactor: use UnpaidBillsPicker
      invoices/new/page.tsx             # add Spread checkbox + picker
    components/
      fabric-purchase-log.tsx           # add Source toggle + customer mode
      unpaid-bills-picker.tsx           # NEW
  db/migrations/
    168_fabric_adjustment_credit_note_modes.sql   # NEW
docs/specs/
  2026-06-14-fabric-stock-credit-note-bill-adjust-design.md   # THIS FILE
```
