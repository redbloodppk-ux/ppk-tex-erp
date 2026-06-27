# DC bundle-wise & piece-wise selection from a production batch

Date: 2026-06-27
Area: `app/app/app/delivery-challan/dc-form.tsx`
Type: front-end only (no DB migration)

## Problem

When an operator builds a Delivery Challan sourced **from a production batch**, ticking
the batch in the "From production batches" picker pulls the *whole* leftover batch onto
the DC. There is no way to ship only some bundles, only some pieces of a bundle, or to
regroup pieces into different bundles on the DC. The operator needs bundle-wise and
piece-wise selection, including moving pieces between bundles, while the batch keeps its
own record for whatever is left.

## Decisions (from the user)

- Selection level: **bundles + pieces** — tick whole bundles, or drill in and tick
  individual pieces (e.g. ship 3 of 5 pieces).
- Partial bundles: **move pieces between bundles** on the DC — a selected piece can be
  assigned to a different DC bundle number so the DC's bundle layout can be regrouped.
- Batch effect: **only the DC changes**. The batch's stored `bundles_detail` is never
  rewritten; the leftover is simply whatever pieces were not shipped.
- Summary-mode batches (no per-piece detail): **keep whole, operator can type metres**.
  No piece checkboxes — there are no pieces to show. Behaves as today.
- The editable bundle grid below the picker **stays** (keep both) so the operator can
  still hand-tweak a seeded item after picking.
- Applies to **all three modes** (in-house, jobwork, outsource) since they share the
  same picker.

## User-facing behaviour

Ticking a detailed batch expands an inline **selection panel** under that picker row:

```
☑ B-26-27-0005   CONGRESS RUNNING FABRIC          Available: 3475.00 m
   ☑ Bundle 1   (5 pcs · 420.00 m)        ▸
   ☑ Bundle 2   (5 pcs · 410.50 m)        ▸
   ☐ Bundle 3   (5 pcs · 400.00 m)        ▾
        ☑ Piece 1   82.00 m      → DC bundle [ 3 ▾ ]
        ☑ Piece 2   80.50 m      → DC bundle [ 3 ▾ ]
        ☐ Piece 3   79.00 m
        ☐ Piece 4   79.50 m
        ☐ Piece 5   79.00 m
   ───────────────────────────────────────────────
   Selected: 12 pcs · 3 bundles · 982.50 m   → on this DC
```

- A **bundle checkbox** ticks/unticks all pieces in that bundle.
- **Expand** a bundle to tick individual pieces.
- The **`→ DC bundle [n]`** dropdown beside each selected piece reassigns it to a
  different DC bundle number. Pieces sharing a number group into one DC bundle; numbers
  with no pieces drop off. Default for every piece is its original batch bundle number,
  so doing nothing reproduces the batch layout.
- The **Selected** summary line shows live metres / pieces / bundle count and equals
  exactly what is written to the DC item.
- A **Select all / Clear** affordance per batch for convenience.

Unselected pieces remain available in the batch for a future DC.

For a **summary-mode batch** the panel shows no piece tree — just a note that it is a
summary batch and the existing whole-quantity seed (metres editable by hand), unchanged
from today.

## Data flow

No schema or save-path change. The seeded `DcItem.bundles` is rebuilt from the current
selection, grouped by the assigned DC bundle number, renumbered `1..n`. On save the form
already:

- writes `delivery_challan_item.bundles_detail` from `it.bundles` (pieces > 0 only),
- rolls `metres / pieces / bundles` from those bundles, and
- depletes stock by the item metres (in-house: `production_fabric` ledger outflow;
  jobwork/outsource: `fabric_stock.metres_out`).

So a partial selection naturally produces a smaller outflow and a correct DC. Regrouping
is purely a front-end relabelling of bundle numbers; the DB already stores arbitrary
`{sno, pieces[]}`.

## Leftover tracking change (the careful part)

Today the loader hides a batch bundle once **any** piece of it has shipped, matching by
**bundle sno** (`deliveredSnosByBatch`). That is wrong once a bundle ships partially or
gets renumbered on a DC.

Switch leftover computation to **match by piece value**:

1. Start from the batch's original `bundles_detail` (the full multiset of piece metres,
   grouped by original sno).
2. Gather every piece already shipped for that batch across all non-cancelled DC items
   (flatten each `dci.bundles_detail.pieces`).
3. Greedily remove each shipped piece value (rounded to 2 dp) from the batch's bundles —
   first matching piece in sno order wins.
4. What remains is the leftover, still grouped under its original batch sno, which is
   what the picker shows for selection.

This correctly leaves "2 of 5 pieces" available, ignores DC bundle renumbering, and needs
no back-reference stored on the DC. Batches already picked on the *current* DC keep their
full selection visible (their own shipment is excluded from the subtraction), preserving
the existing "keep ticked while editing" behaviour.

Unmatched shipped values (data drift / rounding) are skipped — non-fatal, the piece just
stays shown as available.

## Components / state

- `batchSelections: Map<batchId, BatchSelection>` — per-ticked-batch working selection:
  for each leftover piece, `{ origSno, pieceIdx, metres, selected, dcBundle }`.
- Ticking a batch initialises its selection (all selected, `dcBundle = origSno`) and
  seeds the `DcItem` as today; unticking clears both.
- Any selection change recomputes that batch's `DcItem.bundles` (group selected pieces by
  `dcBundle`, renumber) and writes it back into `form.items` keyed by
  `production_batch_id`.
- The `BatchOpt.bundles_detail` already loaded per batch feeds the piece tree.
- Loader change: replace the sno-based `deliveredSnosByBatch` trim with the piece-value
  subtraction described above (both the in-house ledger branch and the jobwork/outsource
  `fabric_stock` branch use the same leftover helper).

## Out of scope

- No change to the manual-entry path, print template, save RPCs, or any migration.
- No re-layout of the batch's stored bundles (explicitly "only the DC changes").

## Verification

1. `npx tsc --noEmit` clean.
2. Live test: pick a real detailed batch, select a partial set across two bundles, move a
   piece into another bundle, save the DC; confirm DC item metres/pieces/bundles and
   `bundles_detail` match the selection and stock depletes by the selected metres.
3. Re-open a new DC from the same batch and confirm the unselected pieces reappear as
   available (leftover-by-piece works), and the shipped ones do not.
4. Summary-mode batch still seeds whole quantity with editable metres.
