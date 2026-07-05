# Warp Beam Batch Numbering (WBG-NNNN) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `jobwork_warp_beam` **batch** (one save action — a whole delivery, whether 1 beam or 14) a single persisted `batch_no`, displayed as `WBG-NNNN`, instead of the current per-row raw `id`. One-time renumber all 10 existing historical batches starting at 1, ordered by date.

**Architecture:** New nullable `batch_no integer` column plus a plain integer `SEQUENCE`. A one-time SQL backfill groups existing rows with the exact key `groupWarpBeamRows()` already uses for on-screen grouping, orders groups by `given_date` then minimum `id`, and numbers them 1..N. Going forward, each of the three insert call sites in `app/app/app/jobwork/page.tsx` (`add()` jobwork branch, `add()` outsource branch, `saveSplit()`) calls a small Postgres RPC function once per save action to pull the next sequence value, then stamps that same value onto every row inserted by that action. All `WBG-${id}` display sites switch to `WBG-${batch_no ?? id}`.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres) via `@supabase/supabase-js` and the Supabase MCP tools (`apply_migration`, `execute_sql`, `generate_typescript_types`).

**Reference spec:** `docs/superpowers/specs/2026-07-05-warp-beam-batch-numbering-design.md`

---

## Task 1: Migration 234 — `batch_no` column, sequence, RPC function, one-time backfill

**Files:**
- Create: `app/db/migrations/234_warp_beam_batch_no.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================================
-- 234: One WBG-NNNN batch number per SAVE ACTION on jobwork_warp_beam, not
-- per physical beam row.
--
-- Two flows insert one jobwork_warp_beam row PER BEAM (add()'s jobwork
-- branch, sequential insert so each beam's pavu.id can be linked back; and
-- saveSplit(), bulk insert when an aggregate row is split into individually
-- tracked beams). Today's WBG-NNNN display is just `WBG-${id}`, so a 14-beam
-- delivery burns 14 consecutive numbers instead of one. See
-- docs/superpowers/specs/2026-07-05-warp-beam-batch-numbering-design.md
--
-- This migration:
--   1. Adds a nullable batch_no column + a plain sequence to hand out new
--      values (nullable at the DB level defensively; the app always
--      supplies it going forward — see the null-safe `?? id` display
--      fallback in the app code changes that follow this migration).
--   2. One-time backfills EVERY existing row (regardless of `status`, so
--      no row is ever left without a permanent number) using the exact
--      grouping key groupWarpBeamRows() already uses for on-screen
--      grouping — rows with beam_count <> 1 are singleton groups, same as
--      today's display — ordered by given_date ascending, tie-broken by
--      each group's lowest id, numbered 1, 2, 3...
--   3. Adds a unique index (nullable-safe — Postgres allows multiple NULLs
--      through a plain unique index, only non-null values are compared) so
--      two batches can never collide.
--   4. Adds fn_next_warp_beam_batch_no(), a SECURITY DEFINER wrapper so the
--      app (supabase-js has no raw-SQL access) can pull exactly one new
--      value per save action and stamp it onto every row that save inserts
--      — never one value per row. Follows the same
--      SECURITY DEFINER + SET search_path + GRANT EXECUTE pattern used by
--      this codebase's other autogen-code functions (e.g.
--      fn_batch_autogen_code in migration 008).
-- ============================================================================

ALTER TABLE public.jobwork_warp_beam ADD COLUMN IF NOT EXISTS batch_no integer;

COMMENT ON COLUMN public.jobwork_warp_beam.batch_no IS 'One number per batch/save-action (not per beam row), shown on screen as WBG-NNNN. All rows inserted by the same save share one batch_no. Assigned from jobwork_warp_beam_batch_no_seq via fn_next_warp_beam_batch_no(). Never renumbered — deleting a batch just skips that number going forward, like a real invoice/DC book.';

CREATE SEQUENCE IF NOT EXISTS public.jobwork_warp_beam_batch_no_seq;

-- One-time historical backfill. Groups ALL existing rows (not filtered by
-- status) using the same key groupWarpBeamRows() uses in the UI:
-- jobwork_party_id, fabric_quality_id, warp_count_id, given_date,
-- reference_no, supplier_party_id, sizing_job_id. Rows with beam_count <> 1
-- are already-aggregate entries and each get their own singleton group,
-- matching today's display exactly.
WITH keyed AS (
  SELECT
    id,
    given_date,
    CASE
      WHEN beam_count <> 1 THEN 'singleton-' || id::text
      ELSE
        COALESCE(jobwork_party_id::text, '') || '|' ||
        COALESCE(fabric_quality_id::text, '') || '|' ||
        COALESCE(warp_count_id::text, '') || '|' ||
        COALESCE(given_date::text, '') || '|' ||
        COALESCE(reference_no, '') || '|' ||
        COALESCE(supplier_party_id::text, '') || '|' ||
        COALESCE(sizing_job_id::text, '')
    END AS grp_key
  FROM public.jobwork_warp_beam
),
group_order AS (
  SELECT
    grp_key,
    ROW_NUMBER() OVER (ORDER BY MIN(given_date) ASC, MIN(id) ASC) AS batch_no
  FROM keyed
  GROUP BY grp_key
)
UPDATE public.jobwork_warp_beam w
SET batch_no = go.batch_no
FROM keyed k
JOIN group_order go ON go.grp_key = k.grp_key
WHERE w.id = k.id;

-- Move the sequence past the highest backfilled value so the very next
-- nextval() call (the first NEW batch saved after this migration lands)
-- continues on from the historical numbering instead of colliding with it.
SELECT setval('public.jobwork_warp_beam_batch_no_seq', (SELECT COALESCE(MAX(batch_no), 0) FROM public.jobwork_warp_beam));

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobwork_warp_beam_batch_no ON public.jobwork_warp_beam (batch_no);

CREATE OR REPLACE FUNCTION public.fn_next_warp_beam_batch_no()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT nextval('public.jobwork_warp_beam_batch_no_seq') INTO v_next;
  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_next_warp_beam_batch_no() TO authenticated;
```

- [ ] **Step 2: Look up the Supabase project id**

Call the Supabase MCP tool `list_projects` (no arguments). Confirm the project id (expected: `cqyfbiecramujnzhgieg`, `ppk-tex-erp` — reconfirm rather than assume).

- [ ] **Step 3: Apply the migration to the live project**

Call the Supabase MCP tool `apply_migration` with:
- `project_id`: the id confirmed in Step 2
- `name`: `warp_beam_batch_no`
- `query`: the exact SQL from Step 1

- [ ] **Step 4: Verify the column, sequence, and index exist**

Call `execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'jobwork_warp_beam' and column_name = 'batch_no';
```
Expected: one row — `batch_no`, `integer`, `YES`.

```sql
select indexname, indexdef
from pg_indexes
where tablename = 'jobwork_warp_beam' and indexname = 'idx_jobwork_warp_beam_batch_no';
```
Expected: one row showing a `UNIQUE INDEX ... (batch_no)` definition.

- [ ] **Step 5: Verify the backfill assigned the expected historical numbering**

At the time this plan was written, the live table had exactly 23 rows forming 10 groups. Call `execute_sql`:
```sql
select id, given_date, reference_no, beam_count, batch_no
from jobwork_warp_beam
order by id;
```
Expected `batch_no` per `id` (chronological by `given_date`, ties broken by lowest `id`):

| id | given_date | batch_no |
|----|------------|----------|
| 6  | 2026-03-06 | 1 |
| 2  | 2026-03-13 | 2 |
| 7  | 2026-03-21 | 3 |
| 8  | 2026-03-21 | 4 |
| 9  | 2026-03-23 | 5 |
| 10 | 2026-03-23 | 6 |
| 3  | 2026-04-10 | 7 |
| 4  | 2026-04-24 | 8 |
| 5  | 2026-05-29 | 9 |
| 31–44 (all 14 rows) | 2026-06-04 | 10 |

If more rows exist by the time this runs (new data entered since this plan was written), the same relative ordering rule still applies — just confirm every row in the 14-beam 2026-06-04 group (ids 31–44) shares one identical `batch_no`, and no two groups share a number.

- [ ] **Step 6: Verify the sequence continues on from the backfill, not from 1**

Call `execute_sql`:
```sql
select last_value from jobwork_warp_beam_batch_no_seq;
```
Expected: `10` (or the actual max `batch_no` from Step 5 if more historical data existed).

- [ ] **Step 7: Verify the RPC function returns increasing values and is callable**

Call `execute_sql`:
```sql
select public.fn_next_warp_beam_batch_no() as next_1, public.fn_next_warp_beam_batch_no() as next_2;
```
Expected: `next_1 = 11`, `next_2 = 12` (each call advances the sequence by one — this is expected and fine, it's only a smoke test; two throwaway values are acceptable since numbers are never reused or renumbered by design).

- [ ] **Step 8: Commit**

```bash
git add app/db/migrations/234_warp_beam_batch_no.sql
git commit -m "feat: add jobwork_warp_beam.batch_no (one WBG number per batch, not per beam)"
```

---

## Task 2: Regenerate TypeScript types

**Files:**
- Modify: `app/lib/database.types.ts`

- [ ] **Step 1: Regenerate**

Call the Supabase MCP tool `generate_typescript_types` with the project id confirmed in Task 1 Step 2. Overwrite `app/lib/database.types.ts` with the tool's output.

- [ ] **Step 2: Verify the new column is present in the generated types**

Run: `grep -A5 "jobwork_warp_beam:" "app/lib/database.types.ts"` and confirm `batch_no: number | null` now appears in the `Row`/`Insert`/`Update` shapes for `jobwork_warp_beam`.

- [ ] **Step 3: Commit**

```bash
git add app/lib/database.types.ts
git commit -m "chore: regenerate Supabase types for jobwork_warp_beam.batch_no"
```

---

## Task 3: `WarpBeamRow` / `WarpBeamGroup` types, select query, and grouping

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:103-123` (`WarpBeamRow` interface)
- Modify: `app/app/app/jobwork/page.tsx:131-139` (`WarpBeamGroup` interface)
- Modify: `app/app/app/jobwork/page.tsx:145-183` (`groupWarpBeamRows`)
- Modify: `app/app/app/jobwork/page.tsx:299` (the Supabase `select` column list)

- [ ] **Step 1: Add `batch_no` to `WarpBeamRow`**

In `app/app/app/jobwork/page.tsx`, find:
```tsx
interface WarpBeamRow {
  id: number; jobwork_party_id: number;
```
Replace with:
```tsx
interface WarpBeamRow {
  id: number; jobwork_party_id: number;
  /** One number per batch/save-action (migration 234) — shown as
   *  WBG-NNNN. Null only for a defensive edge case (a row inserted
   *  outside the app); display code falls back to `id` when null. */
  batch_no: number | null;
```

- [ ] **Step 2: Add `batchNo` to `WarpBeamGroup`**

Find:
```tsx
interface WarpBeamGroup {
  key: string;
  rows: WarpBeamRow[];
  totalBeams: number;
  totalMetres: number;
}
```
Replace with:
```tsx
interface WarpBeamGroup {
  key: string;
  rows: WarpBeamRow[];
  totalBeams: number;
  totalMetres: number;
  /** All rows in a group share one batch_no (they were saved together,
   *  or the historical backfill assigned them the same number). Null
   *  only in the same defensive edge case as WarpBeamRow.batch_no. */
  batchNo: number | null;
}
```

- [ ] **Step 3: Populate `batchNo` when building a group**

Find (inside `groupWarpBeamRows`):
```tsx
    items.push({
      kind: 'group',
      group: {
        key,
        rows: bucket,
        totalBeams: bucket.length,
        totalMetres: bucket.reduce((s, x) => s + Number((x.original_metres ?? x.total_metres) ?? 0), 0),
      },
    });
```
Replace with:
```tsx
    items.push({
      kind: 'group',
      group: {
        key,
        rows: bucket,
        totalBeams: bucket.length,
        totalMetres: bucket.reduce((s, x) => s + Number((x.original_metres ?? x.total_metres) ?? 0), 0),
        batchNo: bucket[0]?.batch_no ?? null,
      },
    });
```

- [ ] **Step 4: Fetch `batch_no` in the initial data load**

Find (line 299):
```tsx
      sb.from('jobwork_warp_beam').select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, tape_length_m, beam_count, total_metres, original_metres, reference_no, notes, supplier_party_id, pavu_id, pavu_ids, sizing_job_id').eq('status', 'active').order('given_date', { ascending: false }),
```
Replace with:
```tsx
      sb.from('jobwork_warp_beam').select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, tape_length_m, beam_count, total_metres, original_metres, reference_no, notes, supplier_party_id, pavu_id, pavu_ids, sizing_job_id, batch_no').eq('status', 'active').order('given_date', { ascending: false }),
```

- [ ] **Step 5: Typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no new errors. (Existing rows fetched via this query now have a `batch_no` field with no producer or consumer yet outside this task — that's expected and resolved in the following tasks.)

- [ ] **Step 6: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: thread batch_no through WarpBeamRow/WarpBeamGroup and the beam-list query"
```

---

## Task 4: Shared `fetchNextBatchNo()` helper

**Files:**
- Modify: `app/app/app/jobwork/page.tsx` (new module-level function, placed directly after `groupWarpBeamRows`, before the `WeftBagRow` interface at line 185)

- [ ] **Step 1: Add the helper**

Find:
```tsx
  return items;
}

interface WeftBagRow {
```
Replace with:
```tsx
  return items;
}

/** Pulls exactly one new jobwork_warp_beam batch number
 *  (fn_next_warp_beam_batch_no, migration 234) for the caller to stamp
 *  onto every row inserted by ONE save action — never call this once
 *  per beam row, only once per save. Throws so callers can surface a
 *  clear error and abort the save rather than silently inserting rows
 *  with a null batch_no (which would defeat the point of this
 *  feature — every new save must get a real number). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchNextBatchNo(sb: any): Promise<number> {
  const { data, error } = await sb.rpc('fn_next_warp_beam_batch_no');
  if (error || data == null) {
    throw new Error(error?.message ?? 'Could not generate a batch number for this save.');
  }
  return Number(data);
}

interface WeftBagRow {
```

- [ ] **Step 2: Typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no new errors (the function is unused so far — wired up in the next three tasks).

- [ ] **Step 3: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: add fetchNextBatchNo() helper for one-batch-number-per-save"
```

---

## Task 5: `add()` jobwork branch — stamp `batch_no` on every beam in the save

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:1914-1922` (`basePayload`)

- [ ] **Step 1: Fetch one batch number before the beam loop and add it to `basePayload`**

Find:
```tsx
      const notesTrimmed = form.notes.trim();
      const sizingSetNoTrimmed = form.sizingSetNo.trim() || null;
      const basePayload = {
        jobwork_party_id:  Number(form.jobwork_party_id),
        fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
        warp_count_id:     form.warp_count_id === '' ? null : Number(form.warp_count_id),
        given_date:        form.given_date,
        reference_no:      form.reference_no.trim() || null,
        supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
        sizing_set_no:     sizingSetNoTrimmed,
      };
```
Replace with:
```tsx
      const notesTrimmed = form.notes.trim();
      const sizingSetNoTrimmed = form.sizingSetNo.trim() || null;
      let batchNo: number;
      try {
        batchNo = await fetchNextBatchNo(sb);
      } catch (e) {
        setBusy(false);
        setErr(e instanceof Error ? e.message : 'Could not generate a batch number for this save.');
        return;
      }
      const basePayload = {
        jobwork_party_id:  Number(form.jobwork_party_id),
        fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
        warp_count_id:     form.warp_count_id === '' ? null : Number(form.warp_count_id),
        given_date:        form.given_date,
        reference_no:      form.reference_no.trim() || null,
        supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
        sizing_set_no:     sizingSetNoTrimmed,
        batch_no:          batchNo,
      };
```

- [ ] **Step 2: Typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 3: Manual smoke test**

On `/app/jobwork`, open "Warp beam given" → Add, pick a party/quality, add 3 beam rows (different beam no/ends/metres each), save. Confirm all 3 new rows show the SAME `WBG-NNNN` number on screen (display wiring lands in Task 8 — until then it's fine if the screen still shows the old per-row id; just confirm the save succeeds with no error). Optionally check directly:
```sql
select id, batch_no from jobwork_warp_beam order by id desc limit 3;
```
Expected: all 3 newly-inserted rows show the identical `batch_no`, one higher than the value confirmed in Task 1 Step 7.

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: assign one batch_no per save in add() jobwork branch"
```

---

## Task 6: `add()` outsource branch — stamp `batch_no` on the aggregate row

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:2025-2044` (`payload`)

- [ ] **Step 1: Fetch one batch number and add it to `payload`**

Find:
```tsx
    const payload = {
      jobwork_party_id:  Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      warp_count_id:     autoWarpCountId,
      given_date:        form.given_date,
      total_ends:        autoEndsValues.length === 1 ? autoEndsValues[0] : null,
      beam_count:        autoBeamCount,
      total_metres:      autoTotalMetres > 0 ? autoTotalMetres : null,
      original_metres:   autoTotalMetres > 0 ? autoTotalMetres : null,
      reference_no:      form.reference_no.trim() || null,
      notes:             form.notes.trim() || null,
      supplier_party_id: supplierPartyId,
      // Aggregate row — no single pavu link. pavu_ids records the
      // exact set of pavus this row represents so the Release
      // action can revert just those beams. total_metres above is the
      // sole stock-outflow figure the warehouse view reads — the
      // individual beam metres are never separately counted.
      pavu_id:           null,
      pavu_ids:          beamIds,
    };
    const { error: insErr } = await sb.from('jobwork_warp_beam').insert(payload);
    if (insErr) { setBusy(false); setErr(insErr.message); return; }
```
Replace with:
```tsx
    let outsourceBatchNo: number;
    try {
      outsourceBatchNo = await fetchNextBatchNo(sb);
    } catch (e) {
      setBusy(false);
      setErr(e instanceof Error ? e.message : 'Could not generate a batch number for this save.');
      return;
    }
    const payload = {
      jobwork_party_id:  Number(form.jobwork_party_id),
      fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
      warp_count_id:     autoWarpCountId,
      given_date:        form.given_date,
      total_ends:        autoEndsValues.length === 1 ? autoEndsValues[0] : null,
      beam_count:        autoBeamCount,
      total_metres:      autoTotalMetres > 0 ? autoTotalMetres : null,
      original_metres:   autoTotalMetres > 0 ? autoTotalMetres : null,
      reference_no:      form.reference_no.trim() || null,
      notes:             form.notes.trim() || null,
      supplier_party_id: supplierPartyId,
      batch_no:          outsourceBatchNo,
      // Aggregate row — no single pavu link. pavu_ids records the
      // exact set of pavus this row represents so the Release
      // action can revert just those beams. total_metres above is the
      // sole stock-outflow figure the warehouse view reads — the
      // individual beam metres are never separately counted.
      pavu_id:           null,
      pavu_ids:          beamIds,
    };
    const { error: insErr } = await sb.from('jobwork_warp_beam').insert(payload);
    if (insErr) { setBusy(false); setErr(insErr.message); return; }
```

Note: this branch's local variable is named `outsourceBatchNo` (not `batchNo`) because both branches live in the same `add()` function body — the jobwork branch already `return`s before this code is reached, so there's no runtime collision, but a distinct name avoids any confusion when reading the function top to bottom.

- [ ] **Step 2: Typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 3: Manual smoke test**

On `/app/outsource`, open "Warp beam given" → Add, complete the party → sizing party → sizing job → beam-checklist cascade, tick 2+ pavu beams, save. Check:
```sql
select id, batch_no, beam_count from jobwork_warp_beam order by id desc limit 1;
```
Expected: the new row has a non-null `batch_no` one higher than the previous highest issued.

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: assign batch_no in add() outsource branch"
```

---

## Task 7: `saveSplit()` — stamp `batch_no` on every beam created by a split

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:2181-2221` (`saveSplit`)

- [ ] **Step 1: Fetch one batch number before building `payloads` and add it to `basePayload`**

Find:
```tsx
  async function saveSplit(parent: WarpBeamRow, rowsIn: BeamRow[]) {
    const beams = rowsIn
      .map((b) => ({ beamNo: b.beamNo.trim(), ends: b.ends, metres: b.metres }))
      .filter((b) => b.beamNo !== '' && b.ends !== '' && b.metres !== '');
    if (beams.length === 0) {
      window.alert('Enter the beam no., ends and metres for at least one beam.');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const notesTrimmed = (parent.notes ?? '').trim();
    const basePayload = {
      jobwork_party_id: parent.jobwork_party_id,
      fabric_quality_id: parent.fabric_quality_id,
      warp_count_id: parent.warp_count_id,
      given_date: parent.given_date,
      reference_no: parent.reference_no,
      supplier_party_id: parent.supplier_party_id,
      sizing_job_id: parent.sizing_job_id,
      pavu_id: null,
      pavu_ids: null,
    };
```
Replace with:
```tsx
  async function saveSplit(parent: WarpBeamRow, rowsIn: BeamRow[]) {
    const beams = rowsIn
      .map((b) => ({ beamNo: b.beamNo.trim(), ends: b.ends, metres: b.metres }))
      .filter((b) => b.beamNo !== '' && b.ends !== '' && b.metres !== '');
    if (beams.length === 0) {
      window.alert('Enter the beam no., ends and metres for at least one beam.');
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    let splitBatchNo: number;
    try {
      splitBatchNo = await fetchNextBatchNo(sb);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not generate a batch number for this split.');
      return;
    }
    const notesTrimmed = (parent.notes ?? '').trim();
    const basePayload = {
      jobwork_party_id: parent.jobwork_party_id,
      fabric_quality_id: parent.fabric_quality_id,
      warp_count_id: parent.warp_count_id,
      given_date: parent.given_date,
      reference_no: parent.reference_no,
      supplier_party_id: parent.supplier_party_id,
      sizing_job_id: parent.sizing_job_id,
      batch_no: splitBatchNo,
      pavu_id: null,
      pavu_ids: null,
    };
```

A split deliberately gets a **new** batch number (not the parent's old one) — the parent aggregate row is deleted right after the split rows are inserted (see the existing `delErr` line below), so its old number is retired for good, same as any deleted batch.

- [ ] **Step 2: Typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 3: Manual smoke test**

Pick any existing aggregate warp-beam row with `beam_count > 1` and no pavu link, click the Split icon, fill in per-beam details, save. Check:
```sql
select id, batch_no from jobwork_warp_beam where reference_no = '<that row''s reference_no>' order by id;
```
Expected: every newly-created beam row shares one identical `batch_no`, and the original parent row's `id` no longer exists (deleted by the existing `delErr` step).

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: assign one batch_no per split action in saveSplit()"
```

---

## Task 8: Display — switch all `WBG-NNNN` sites from `id` to `batch_no`

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:2240` (mobile card, editing state)
- Modify: `app/app/app/jobwork/page.tsx:2260` (mobile card, display state)
- Modify: `app/app/app/jobwork/page.tsx:2323` (desktop row, editing state)
- Modify: `app/app/app/jobwork/page.tsx:2348` (desktop row, display state)
- Modify: `app/app/app/jobwork/page.tsx:2404-2412` (`groupIdLabel`)

- [ ] **Step 1: Mobile card — editing state**

Find:
```tsx
              <span className="font-mono text-xs text-ink-mute">{`WBG-${String(r.id).padStart(4, '0')}`}</span>
```
Replace with:
```tsx
              <span className="font-mono text-xs text-ink-mute">{`WBG-${String(r.batch_no ?? r.id).padStart(4, '0')}`}</span>
```

- [ ] **Step 2: Mobile card — display state**

Find:
```tsx
                <div className="font-mono text-xs font-semibold">{`WBG-${String(r.id).padStart(4, '0')}`}</div>
```
Replace with:
```tsx
                <div className="font-mono text-xs font-semibold">{`WBG-${String(r.batch_no ?? r.id).padStart(4, '0')}`}</div>
```

- [ ] **Step 3: Desktop row — editing state**

Find:
```tsx
              {/* ID — auto-issued, never editable. */}
              <td className="px-3 py-2 font-mono text-xs text-ink-mute">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
```
Replace with:
```tsx
              {/* ID — auto-issued, never editable. */}
              <td className="px-3 py-2 font-mono text-xs text-ink-mute">{`WBG-${String(r.batch_no ?? r.id).padStart(4, '0')}`}</td>
```

- [ ] **Step 4: Desktop row — display state**

Find:
```tsx
              {/* Auto-issued ID derived from the row's
                  numeric primary key — short, sortable, and
                  unique without a schema change. */}
              <td className="px-3 py-2 font-mono text-xs font-semibold">{`WBG-${String(r.id).padStart(4, '0')}`}</td>
```
Replace with:
```tsx
              {/* Auto-issued batch number (migration 234) — one per
                  save action, not per beam row. Falls back to the raw
                  id only for the defensive edge case of a row whose
                  batch_no is still null (see WarpBeamRow.batch_no). */}
              <td className="px-3 py-2 font-mono text-xs font-semibold">{`WBG-${String(r.batch_no ?? r.id).padStart(4, '0')}`}</td>
```

- [ ] **Step 5: Simplify `groupIdLabel` — one shared number, no more range**

Find:
```tsx
  // Short label for a merged group's ID column — the id range covered
  // by its underlying beam rows, e.g. "WBG-0023…0029".
  function groupIdLabel(g: WarpBeamGroup): string {
    const ids = g.rows.map((x) => x.id).sort((a, b) => a - b);
    const pad = (n: number) => String(n).padStart(4, '0');
    const first = ids[0] ?? 0;
    const last = ids[ids.length - 1] ?? first;
    return ids.length === 1 ? `WBG-${pad(first)}` : `WBG-${pad(first)}\u2026${pad(last)}`;
  }
```
Replace with:
```tsx
  // Every row in a group shares one batch_no (migration 234), so there
  // is no id range left to compute — the group just displays its one
  // shared number. Falls back to the group's first row's raw id only
  // in the same defensive null edge case as the standalone rows above.
  function groupIdLabel(g: WarpBeamGroup): string {
    const pad = (n: number) => String(n).padStart(4, '0');
    return `WBG-${pad(g.batchNo ?? g.rows[0]?.id ?? 0)}`;
  }
```

- [ ] **Step 6: Typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no new errors.

- [ ] **Step 7: Manual verification against the live 14-beam group**

Open `/app/jobwork` (or `/app/outsource`, whichever the party-kind-1 rows belong to) → "Warp beam given" tab. Confirm the 2026-06-04 group (previously displayed as `WBG-0031…0044`) now displays as a single `WBG-0010` (per the Task 1 Step 5 table). Confirm the standalone rows for ids 6, 2, 7, 8, 9, 10, 3, 4, 5 now show `WBG-0001` through `WBG-0009` respectively, matching the Task 1 Step 5 table.

- [ ] **Step 8: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: display WBG-NNNN from batch_no instead of raw row id"
```

---

## Task 9: Final verification and push

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run (from the `app/` directory): `npx tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 2: Re-run the live numbering check**

Call `execute_sql`:
```sql
select batch_no, count(*) as rows_in_batch, count(distinct id) as distinct_ids
from jobwork_warp_beam
group by batch_no
order by batch_no;
```
Expected: 10 rows (one per historical batch, per Task 1 Step 5), `batch_no` values 1 through 10 with no gaps and no duplicates, plus one additional row per any new batch saved during the Task 5/6/7 manual smoke tests.

- [ ] **Step 3: Confirm no row is missing a batch_no**

Call `execute_sql`:
```sql
select count(*) from jobwork_warp_beam where batch_no is null;
```
Expected: `0`.

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Confirm the Vercel deployment picks up the change**

Call the Vercel MCP tool to list recent deployments for the `ppk-tex-erp` project (`prj_mKFlvYjJEwZzwKsAWqzkmFrmnLy9`) and confirm a new deployment triggered off the latest `main` commit reaches `READY` state.
