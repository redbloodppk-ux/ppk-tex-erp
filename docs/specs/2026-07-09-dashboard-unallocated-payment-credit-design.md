# Dashboard: Net Unallocated Payments into Outstanding Customer Payments

**Date:** 2026-07-09
**Status:** Approved

## Problem

A full reconciliation of the Dashboard's "Outstanding Customer Payments" widget
against the Ledger page (per-party running balance) found 2 of 26 customer
parties genuinely disagreed:

- Varnaa Cotton Mills: Dashboard overstates outstanding by ₹39,060
- Venkateshwarra Stores: Dashboard overstates outstanding by ₹40,000

Root cause: both customers have real `payment` rows (cash already received,
`direction='in'`) that are not fully allocated to a bill — some ticked no bill
at all, some had a payment amount larger than the bill(s) ticked. The Ledger
page's running balance sums every payment regardless of allocation, so it
already reflects this correctly. The Dashboard widget only sums unpaid
`invoice.balance` / `party_opening_ledger.balance` rows — it never looks at
`payment`, so the unallocated leftover of a payment is invisible to it and the
customer appears to owe more than they actually do.

Verified for both parties: unallocated payment total ties out exactly to the
Dashboard/Ledger gap (₹39,060 and ₹40,000 respectively), across payments
`PAY/26-27/0001`, `0002`, `0114` (Varnaa) and the unallocated portions of
`PAY/26-27/0087`, `0089`, `0091` (Venkateshwarra).

## Fix

No schema change, no new table, no new UI. The existing "Keep remaining ₹X on
account" checkbox on the Payments page is already the correct way to record
this — the Dashboard just needs to read it.

Add `mergeUnallocatedAdvances()` in `app/app/app/dashboard/page.tsx`, mirroring
the existing `mergeOpeningLedger()` pattern (added in the prior Dashboard
reconciliation task):

1. Query `payment` rows where `direction='in'`, joined to `party` (customer
   parties only — same party-name resolution the rest of the customer section
   already uses).
2. For each payment, compute `unallocated = payment.amount
   - sum(payment_allocation.amount where payment_id = payment.id)
   - sum(payment_opening_allocation.amount where payment_id = payment.id)`.
3. Where `unallocated > 0.005`, fold it into the matching customer group as a
   negative line (a credit — same as an opening-ledger credit today): reduces
   `group.total` and appears as a `bills[]` entry so it's visible in the
   per-party breakdown, e.g. "Advance — PAY/26-27/0001  −25,960".
4. Apply after `mergeOpeningLedger()` in the existing pipeline so both credit
   sources net together for each customer.

Parties with no open bill but an unallocated credit still surface (matching
`mergeOpeningLedger`'s existing behavior of not silently dropping a
credit-only party).

## Out of scope

- The separate "Outstanding Customer Payments" headline card driven by
  `v_customer_outstanding` (a DB view joining `invoice.customer_id`, which is
  known-unreliable) is a distinct, legacy figure and not touched here.
- The Ledger page's own minor credit-note double-counting quirk (Pradeep
  Export, Sanjay Enterprises, Shree Jagannath Textiles, Shri Giriraj Textiles),
  identified during the same reconciliation, is unrelated and deferred.

## Verification

- Varnaa Cotton Mills and Venkateshwarra Stores totals on the Dashboard match
  the Ledger page after the fix.
- Spot-check a handful of the other 24 already-reconciled parties to confirm
  no regression (their unallocated-payment total should be ~0, so their
  Dashboard total is unchanged).
