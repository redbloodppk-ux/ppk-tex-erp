# Fabric Receipt Stock Reduction Formula Fix — Design

**Date:** 2026-07-06
**Status:** Approved by user, ready for implementation planning

## Problem

Fabric Receipt currently reduces four stock pools (warp beam metres, bobbin
metres, weft kg, porvai kg) from a single value `m` (= `count × towel_length`
for towel-type rows, or the raw entered metres for plain-yardage rows). This
is wrong for towel qualities: consuming the *full* fabric metres from the
warp beam over-deducts the beam. The correct relationship for a towel
quality is that only **half** the towel length (by default) comes off the
warp beam per towel — e.g. a 1.7 m towel consumes 0.85 m of warp per piece,
not 1.7 m.

## Scope

Applies to:
- New fabric receipt entry (`fabric-receipt/new/fabric-receipt-form.tsx`)
- Edit / re-entry of an existing receipt (same shared form, `reuse` prop)
- The delete/cancel reversal path (`fabric-receipt/[id]/actions.ts`)

Does **not** change:
- Non-towel / plain-yardage rows (no `towel_length` set) — these remain 1:1
  with received metres, exactly as today.
- The recorded "total received fabric metres" (`count × towel_length`) used
  for DC/pavu stock, invoicing, and piece counts — unaffected by this change.

## Formula (towel rows only, `towel_length > 0`)

A new **editable reduction factor** is added per receipt line:

- Default: `reduction_factor = round2(towel_length / 2)`
  (e.g. towel_length 1.7 → default factor 0.85)
- User can override to any decimal in the confirm popup (see below).
  Entering `1` means a full 1:1 ratio (no halving) for that line.

Given `count` = number of towels received (existing `no_of_pieces` /
`received_metres` value when `entry_mode = 'pcs'`):

```
halvedM = round2(count × reduction_factor)

warp_beam_metres_consumed = halvedM
bobbin_metres_consumed    = halvedM        // 1:1 with warp — bobbin_pcs_per_m
                                            // no longer multiplies this value
weft_consumed_kg          = round2(halvedM × weft_kg_per_m)
porvai_consumed_kg        = round2(halvedM × porvai_kg_per_m)
```

`resolvedMetres(it)` (the existing `m = count × towel_length` full value)
is kept unchanged and continues to drive: total received metres shown in
totals, `no_of_pieces`, and any DC/pavu stock reference — only the four
consumption pools above switch from `m` to `halvedM`.

## Non-towel rows (no `towel_length`)

Unchanged: `halvedM = m` (received metres), i.e. `reduction_factor` behaves
as if it were `1` for these rows. The reduction factor field may still be
shown (defaulted to 1) for consistency, editable the same way.

## New: Confirm-before-save popup

Before a receipt is finally saved (new or edit), show a summary dialog
listing, per line item:
- Fabric quality / label
- Received metres (full `m`)
- Reduction factor (**editable inline**, live-recalculates the row)
- Computed warp beam metres, bobbin metres, weft kg, porvai kg

Actions: **Confirm** (proceeds with save using whatever factor values are
currently shown) or **Cancel** (closes popup, returns to the form to edit
raw inputs). This popup appears for every receipt, towel or plain-yardage.

## Consistency across new / edit / reversal

- The `halvedM`-based numbers computed at save time are what get written to
  `stock_ledger.quantity` for the `warp_beam` / `bobbin` / `weft_yarn` /
  `porvai_yarn` buckets (same mechanism as today, just fed the corrected
  value).
- The reversal path (`reverseReceiptStock` in `[id]/actions.ts`) restores
  stock by reading `stock_ledger.quantity` directly — it does not
  recompute the formula. As long as save-time writes the corrected
  `halvedM`-based quantity into the ledger, reversal stays correct
  automatically, with no changes needed to the reversal code itself.
- Editing a receipt goes through the same reversal (`reverseReceiptStock`)
  then a fresh save with the (possibly adjusted) reduction factor — so the
  same formula path is used for new and edited receipts alike.

## Schema change

Add one new nullable column so the factor actually used on a line is
auditable and edits can re-show what was applied:

- `fabric_receipt_item.reduction_factor numeric null` — the factor used for
  that line at save time (`towel_length / 2` by default, or the user's
  override). `null` for plain-yardage rows.

`towel_length` itself needs no schema change — it already exists as an
editable per-line field seeded from `fabric_quality.meter_per_pc`.

## Out of scope / explicitly deferred

- Per-quality-configurable divisor (e.g. always ÷2, not ÷1.5 or ÷3 for some
  qualities) — user confirmed ÷2 is universal; no new master-data field
  needed for this.
