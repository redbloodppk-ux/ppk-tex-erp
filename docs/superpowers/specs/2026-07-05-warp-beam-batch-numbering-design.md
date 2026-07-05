# Warp Beam Batch Numbering (WBG-NNNN) — Design

## Problem

`jobwork_warp_beam` displays a "WBG-NNNN" identifier on every row, computed as
`WBG-${String(row.id).padStart(4, '0')}` (`app/app/app/jobwork/page.tsx`, four
call sites: mobile card, desktop row, and a range helper for grouped rows).

`row.id` is the table's raw serial primary key. Two flows create **one DB row
per physical beam**, not one row per save action:

- `add()` (jobwork kind, manual beam-wise entry) — a `for` loop inserts one
  `jobwork_warp_beam` row per beam so each beam's freshly-created `pavu.id`
  can be captured and linked back (`pavu_id`) in row order; a bulk insert
  can't guarantee that correspondence.
- `saveSplit()` — bulk-inserts one row per beam when an existing aggregate
  row is split into individually-tracked beams.

Consequence: saving a 14-beam batch consumes 14 consecutive `id` values, and
the already-existing display grouping (`groupWarpBeamRows`) collapses them
into one line labeled with a *range*, e.g. `WBG-0031…0044`. The ask: assign
one WBG number per batch, not per beam, and one-time renumber existing data
starting at 1, ordered by date.

The "outsource" kind (pavu-driven cascade) already inserts a single
aggregate row per save (beam count tracked via `beam_count`), so it's
already effectively "one ID per batch" — it just shares the same `id`
sequence and display code path.

## What already exists: `groupWarpBeamRows`

The page already groups rows sharing `beam_count === 1` into one visual
block when they match on:

```
jobwork_party_id, fabric_quality_id, warp_count_id, given_date,
reference_no, supplier_party_id, sizing_job_id
```

This is a display-only heuristic (no persisted grouping key today). The new
batch numbering reuses this exact key for the one-time historical backfill,
so the backfilled numbers agree with what the screen already shows as one
group.

## Design

### 1. Schema

New migration:

- `ALTER TABLE jobwork_warp_beam ADD COLUMN batch_no integer;`
- `CREATE SEQUENCE jobwork_warp_beam_batch_no_seq;`
- Backfill (one-time, see below), then set the sequence's next value past
  the max assigned `batch_no`.
- Add a unique index on `batch_no` (nullable-safe — only enforced for
  non-null values, which is Postgres's default behavior for a plain unique
  index) so two batches can never collide.
- Column stays nullable at the DB level (defensive; the app always supplies
  it going forward, but a null-safe display fallback keeps old code paths
  from crashing if a row is ever inserted outside the app, e.g. via a
  future admin script or a Supabase Studio edit).

### 2. One-time backfill (existing rows)

1. Group existing rows using the exact `groupWarpBeamRows` key above (rows
   with `beam_count !== 1` are each their own singleton group, same as
   today's display).
2. Order the resulting groups by `given_date` ascending, tie-broken by each
   group's minimum `id` ascending.
3. Assign `batch_no = row_number()` over that order, starting at 1, to
   every row in the group (all rows in a group get the same `batch_no`).
4. `SELECT setval('jobwork_warp_beam_batch_no_seq', (SELECT max(batch_no) FROM jobwork_warp_beam))`.

This is a pure SQL migration (window function grouping + update), no app
code involved, and is a one-time historical rewrite — it does not run
again.

### 3. Going forward: assigning `batch_no` at save time

Each of the three insert call sites that write to `jobwork_warp_beam` fetches
**one** `nextval('jobwork_warp_beam_batch_no_seq')` per save action (not per
row), and stamps it onto every row inserted in that action:

- `add()` jobwork branch: fetch once before the beam loop, include in
  `basePayload` (currently already shared across all per-beam inserts —
  `batch_no` joins `jobwork_party_id`, `fabric_quality_id`, etc. as a
  base-payload field).
- `saveSplit()`: fetch once before building `payloads`, include in
  `basePayload` the same way.
- `add()` outsource branch (single-row insert): fetch once, include in
  that row's payload.

New batches are **not** re-sorted by date — they always get the next
sequence value, in save order. This means a back-dated entry saved later
does not renumber anything that came before it; already-issued numbers
(which may be written on paper delivery challans) never move. This was
confirmed with the business owner as the desired behavior over
recalculating live from date order.

### 4. Display

All four `WBG-${String(r.id).padStart(4, '0')}` call sites switch to
`WBG-${String(r.batch_no).padStart(4, '0')}`. The grouped-range helper
(`WBG-0023…0029` style, ~line 2405-2411) simplifies: since every row in a
group now shares one `batch_no`, there is no range to compute — the group
just displays its single shared number.

`WarpBeamRow` (the TS interface / Supabase select) gains `batch_no: number
| null` alongside the existing `id` field. TypeScript types are
regenerated from the live schema after the migration lands.

### 5. Edge cases

- **Old rows with `batch_no` still null** (a row inserted before the
  migration's backfill covered it, e.g. a race during deploy): the backfill
  step covers 100% of existing rows at migration time, so this shouldn't
  occur in practice. As a defensive fallback, display code uses
  `r.batch_no ?? r.id` so nothing ever renders a blank ID.
- **Deleting a batch**: no renumbering. Deleted numbers are simply skipped
  going forward (same as any real invoice/DC numbering scheme).
- **Backfill grouping mistakes**: if two genuinely separate deliveries
  share every one of the seven grouping fields on the same day (no
  reference number and everything else identical), they get merged into
  one batch number. This is an existing, accepted limitation of
  `groupWarpBeamRows` itself (the screen already shows them as one
  collapsed group today) — the backfill doesn't introduce new risk here,
  it just makes the existing display grouping permanent as a stored number.

## Out of scope

- No change to `groupWarpBeamRows`'s live grouping logic itself — only the
  number displayed on the (already-existing) group/row changes.
- No change to how beams are split, restocked, or deleted.
- No UI for manually renumbering or editing `batch_no`.
