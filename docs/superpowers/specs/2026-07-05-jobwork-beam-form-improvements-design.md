# Jobwork Beam Form Improvements — Design Spec

## Background

On `/app/jobwork` → **Warp beam given** tab, when `kind === 'jobwork'` (party = a
jobwork party), the "Add warp beam given" form has two problems the operator
flagged:

1. It shows a **"Sizing job"** dropdown (`jobwork/page.tsx` line ~2428,
   `allSizingJobs.map(...)`) sourced from the mill's own `sizing_job` table.
   That dropdown was copied from the outsource form (`187_jobwork_warp_beam_sizing_job.sql`),
   where it correctly records which of the mill's own in-house sizing batches
   a beam came from. It doesn't fit jobwork: a jobwork beam arrives **already
   sized by the external party** — the mill never created a `sizing_job` row
   for it, so the dropdown never has a matching entry.
2. Each beam row requires the operator to hand-type a **Beam No** for every
   single beam (`beamRows` state, one row per beam, "+ Add beam" to add more).
   In practice the jobwork/sizing party already assigns beam numbers
   sequentially to a batch (e.g. 101, 102, 103...), so retyping each one is
   unnecessary manual work.

## Goal

Replace the "Sizing job" dropdown with a free-text "Sizing Set No" field, and
let the operator generate a batch of beam rows from a starting beam number +
count instead of typing every Beam No by hand.

## Schema change — new migration

Add two nullable text columns (no FK, no validation):

```sql
ALTER TABLE public.jobwork_warp_beam ADD COLUMN IF NOT EXISTS sizing_set_no text;
ALTER TABLE public.pavu ADD COLUMN IF NOT EXISTS sizing_set_no text;
```

`jobwork_warp_beam.sizing_job_id` and `pavu.sizing_job_id` are **not** touched
or dropped — they stay in place for legacy rows. New jobwork entries created
after this change simply stop populating `sizing_job_id` (it's already
nullable, per migration 231).

## Form changes — `jobwork/page.tsx`, `WarpBeamTab`, `kind === 'jobwork'` branch

- Remove the "Sizing job" `<select>` block (~line 2428-2432).
- Add a "Sizing Set No" plain text `<input>` in its place, bound to a new
  form field (e.g. `form.sizingSetNo: string`). Free text, no validation, no
  lookup against `sizing_job.set_no` or anything else — matches how
  `set_no` is already just a plain displayed/sorted text field on the
  `/app/sizing` page (no cross-checking there either).
- In the Beams section (~line 2439-2481), add two new number inputs —
  **"Beam No starting"** and **"No. of beams"** — plus a **"Generate beams"**
  button.
  - Clicking Generate replaces the current `beamRows` array with exactly
    "No. of beams" rows. Row `i`'s `beamNo` defaults to
    `String(Number(startingBeamNo) + i)` (0-indexed), `ends`/`metres` left
    blank for the operator to fill in per beam.
  - If any existing row already has a non-empty `beamNo`, `ends`, or
    `metres` value, show a `window.confirm` before overwriting (consistent
    with the existing confirm-before-destructive-action pattern already used
    elsewhere in this file, e.g. `del()`).
  - The existing "+ Add beam" / "×" remove controls are untouched — after
    Generate, every row (including Beam No) stays a normal editable input,
    so the operator can hand-fix a gap or exception in the physical
    numbering.
  - Beam No stays a plain number by convention (starting field is numeric);
    no prefix/suffix handling is added.

## Save logic — `add()`, `kind === 'jobwork'` branch

- `basePayload` (~line 1884-1892): remove `sizing_job_id: ...` (stop
  populating it for new rows — column stays nullable and simply unused going
  forward for jobwork), add `sizing_set_no: form.sizingSetNo.trim() || null`.
- The per-beam `pavu` insert (~line 1901-1911) also gets
  `sizing_set_no: form.sizingSetNo.trim() || null` — same value stored on
  both rows, so it's visible wherever the pavu row surfaces later.
- Form reset (~line 1938-1943) additionally clears `sizingSetNo`,
  `startingBeamNo`, and the beam-count input back to defaults.
- `startingBeamNo` and "No. of beams" are local, UI-only state used purely to
  drive the Generate button — they are never sent to the database directly.
  Each generated row still saves through the existing per-beam insert path,
  which already hardcodes `beam_count: 1` per row (unchanged from the
  current implementation).

## Downstream display

Since Sizing Set No is now carried onto the `pavu` row, it should be visible
wherever jobwork-sourced pavu stock is already tagged with its supplying
party:

- **Pavu Master → Jobwork tab** (`jobwork-beams-table.tsx`): show Sizing Set
  No alongside the existing beam no / status columns.
- **Loom View** (`pavu/assign/page.tsx`): append the set no to the existing
  jobwork tag in both places it currently appears — the mountable-stock
  dropdown option (today: `· Jobwork (Party Name)`) and the mounted-loom card
  tag (today: `Jobwork beam — supplied by Party Name`) — e.g.
  `· Jobwork (Party Name, Set 12)` and
  `Jobwork beam — supplied by Party Name (Set 12)`. If a beam has no set no
  recorded (legacy row, or operator left it blank), the suffix is simply
  omitted.

## Out of scope

- The Beam Stock Report (`pavu/report/page.tsx`, backed by
  `fn_pavu_stock_report`) is **not** updated to show Sizing Set No — it's
  driven by a separate DB function and touching it is unrelated to this
  form-usability fix. Can be a follow-up if wanted later.
- No change to the outsource flow or its own "Sizing job" cascade picker —
  that dropdown is correct as-is for outsource (it really does reference the
  mill's own sizing jobs).
- No change to, or removal of, the `sizing_job_id` columns themselves on
  either `jobwork_warp_beam` or `pavu` — legacy data referencing real sizing
  jobs is left alone.
- No validation tying "Sizing Set No" to any existing `sizing_job.set_no`
  value — it's a free-text label only.
