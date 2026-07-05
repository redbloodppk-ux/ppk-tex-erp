# Jobwork Beam Form Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/app/jobwork`'s "Warp beam given" Add form (jobwork-kind parties only), replace the broken "Sizing job" dropdown with a free-text "Sizing Set No" field, and let the operator auto-generate beam rows from a starting Beam No + count instead of typing every beam number by hand.

**Architecture:** One new nullable text column (`sizing_set_no`) on both `jobwork_warp_beam` and `pavu`, populated only by the jobwork branch of `jobwork/page.tsx`'s `add()` function. Two small pieces of new local UI state (`beamNoStart`, `beamGenCount`) drive a `generateBeamRows()` helper that rewrites the existing `beamRows` array — the existing manual add/remove/edit-per-row mechanism is untouched. The field is then threaded through to the two places it's already displayed downstream: Pavu Master's Jobwork tab table and Loom View's jobwork tags.

**Tech Stack:** Next.js (App Router) + TypeScript, Supabase (Postgres) via `@supabase/supabase-js`, Tailwind CSS.

---

## Task 1: Migration 232 — add `sizing_set_no` columns

**Files:**
- Create: `app/db/migrations/232_jobwork_beam_sizing_set_no.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Jobwork beams arrive pre-sized by an external party — there is no
-- matching row in our own sizing_job table for them. The "Sizing job"
-- dropdown on /app/jobwork's jobwork-kind Add form was copied from the
-- outsource flow and can never be filled in correctly for jobwork
-- entries (jobwork_warp_beam.sizing_job_id, added in migration 187,
-- stays in place for legacy rows but new jobwork entries stop
-- populating it). Replace it with a plain free-text "Sizing Set No"
-- field — same unvalidated free-text pattern as sizing_job.set_no.
--
-- Also added to pavu so the set no is visible downstream on Pavu
-- Master's Jobwork tab and the Loom View jobwork tags without a join
-- back to jobwork_warp_beam.
ALTER TABLE public.jobwork_warp_beam ADD COLUMN IF NOT EXISTS sizing_set_no text;
ALTER TABLE public.pavu             ADD COLUMN IF NOT EXISTS sizing_set_no text;

COMMENT ON COLUMN public.jobwork_warp_beam.sizing_set_no IS 'Free-text sizing set number supplied by the jobwork party. Not validated against sizing_job — jobwork beams are sized externally.';
COMMENT ON COLUMN public.pavu.sizing_set_no IS 'Free-text sizing set number, populated for jobwork-mode pavu rows only. Mirrors jobwork_warp_beam.sizing_set_no for downstream display (Pavu Master, Loom View).';
```

- [ ] **Step 2: Look up the Supabase project id**

Call the Supabase MCP tool `list_projects` (no arguments). Confirm the project id you'll use for the remaining steps (expected: the mill's single project, id `cqyfbiecramujnzhgieg` — reconfirm rather than assume, in case it changed).

- [ ] **Step 3: Apply the migration to the live project**

Call the Supabase MCP tool `apply_migration` with:
- `project_id`: the id confirmed in Step 2
- `name`: `jobwork_beam_sizing_set_no`
- `query`: the exact SQL from Step 1

- [ ] **Step 4: Verify the columns exist**

Call the Supabase MCP tool `execute_sql` with:
```sql
select table_name, column_name, data_type
from information_schema.columns
where table_name in ('jobwork_warp_beam', 'pavu')
  and column_name = 'sizing_set_no'
order by table_name;
```
Expected: two rows, one per table, both `data_type = 'text'`.

- [ ] **Step 5: Commit**

```bash
git add app/db/migrations/232_jobwork_beam_sizing_set_no.sql
git commit -m "feat: add sizing_set_no column to jobwork_warp_beam and pavu"
```

---

## Task 2: Form state — add Sizing Set No + beam-generation fields

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:1468-1490`

- [ ] **Step 1: Add `sizingSetNo` to the `form` state**

Current code (lines 1468-1475):
```typescript
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
    total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
    // New (outsource flow): the sizing job the operator is sourcing
    // beams from. When set we list its pavu rows below and the
    // operator ticks the ones to include.
    sizing_job_id: '',
  });
```

Replace with:
```typescript
  const [form, setForm] = useState({
    given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
    total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
    // New (outsource flow): the sizing job the operator is sourcing
    // beams from. When set we list its pavu rows below and the
    // operator ticks the ones to include.
    sizing_job_id: '',
    // New (jobwork flow only): free-text sizing set no supplied by the
    // jobwork party. Not validated against sizing_job — jobwork beams
    // are sized externally, so there's no matching row to reference.
    sizingSetNo: '',
  });
```

- [ ] **Step 2: Add beam-generation local state right after the existing beam-row helpers**

Current code (lines 1480-1490):
```typescript
  interface BeamRow { beamNo: string; ends: string; metres: string; }
  const [beamRows, setBeamRows] = useState<BeamRow[]>([{ beamNo: '', ends: '', metres: '' }]);
  function addBeamRow(): void {
    setBeamRows((rows) => [...rows, { beamNo: '', ends: '', metres: '' }]);
  }
  function removeBeamRow(idx: number): void {
    setBeamRows((rows) => (rows.length <= 1 ? rows : rows.filter((_, i) => i !== idx)));
  }
  function updateBeamRow(idx: number, field: keyof BeamRow, value: string): void {
    setBeamRows((rows) => rows.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }
```

Append immediately after (still before `const [busy, setBusy] = useState(false);`):
```typescript
  // Jobwork manual-entry form only: "Generate beams" helper. Beam No
  // is assigned by the jobwork/sizing party and is sequential, so the
  // operator can type a starting number + count instead of typing
  // every beam no by hand. These two fields are UI-only — they are
  // never sent to the database; only the resulting beamRows are saved,
  // through the same per-beam insert path as manually-typed rows.
  const [beamNoStart, setBeamNoStart] = useState('');
  const [beamGenCount, setBeamGenCount] = useState('1');
  function generateBeamRows(): void {
    const start = Number(beamNoStart);
    const count = Number(beamGenCount);
    if (!Number.isFinite(start) || start <= 0 || !Number.isInteger(start)) return;
    if (!Number.isFinite(count) || count <= 0 || !Number.isInteger(count)) return;
    const hasExistingData = beamRows.some((r) => r.beamNo !== '' || r.ends !== '' || r.metres !== '');
    if (hasExistingData && !window.confirm('This will replace the current beam rows. Continue?')) return;
    const rows: BeamRow[] = Array.from({ length: count }, (_, i) => ({
      beamNo: String(start + i), ends: '', metres: '',
    }));
    setBeamRows(rows);
  }
```

- [ ] **Step 3: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: no new errors (there is no runnable UI test in this codebase; typecheck is the correctness gate used throughout this project).

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: add sizingSetNo form field and beam-generation state"
```

---

## Task 3: Replace the "Sizing job" dropdown with "Sizing Set No"

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:2428-2432`

- [ ] **Step 1: Replace the dropdown**

Current code (lines 2428-2432):
```jsx
          <div><label className="label text-xs">Sizing job</label>
            <select className="input" value={form.sizing_job_id} onChange={(e) => setForm({ ...form, sizing_job_id: e.target.value })}>
              <option value="">---</option>
              {allSizingJobs.map((j) => <option key={j.id} value={j.id}>{j.job_code}{j.set_no ? ' · Set ' + j.set_no : ''}</option>)}
            </select></div>
```

Replace with:
```jsx
          <div><label className="label text-xs">Sizing Set No</label>
            <input
              className="input"
              placeholder="e.g. 12"
              value={form.sizingSetNo}
              onChange={(e) => setForm({ ...form, sizingSetNo: e.target.value })}
            /></div>
```

- [ ] **Step 2: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: `allSizingJobs` is now unused in this file — `tsc --noEmit` does not flag unused variables by default, so this should still pass. (Task 6 removes the now-dead state/effect entirely; if your editor's linter flags it before then, that's expected and resolved by Task 6.)

- [ ] **Step 3: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: replace Sizing job dropdown with Sizing Set No text field"
```

---

## Task 4: Add "Beam No starting" / "No. of beams" / "Generate beams" controls

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:2439-2481`

- [ ] **Step 1: Insert the generation controls above the beam-row list**

Current code (lines 2439-2444):
```jsx
        {/* Beam-wise entry — beam no. + ends + metres typed per beam.
            Each row becomes its own jobwork_warp_beam row on save. */}
        <div>
          <label className="label text-xs">Beams *</label>
          <div className="space-y-2">
            {beamRows.map((b, idx) => (
```

Replace with:
```jsx
        {/* Beam-wise entry — beam no. + ends + metres typed per beam.
            Each row becomes its own jobwork_warp_beam row on save. */}
        <div>
          <label className="label text-xs">Beams *</label>
          <div className="flex items-end gap-2 mb-2">
            <div>
              <label className="label text-xs">Beam No starting</label>
              <input
                type="number"
                placeholder="e.g. 101"
                className="input w-28"
                value={beamNoStart}
                onChange={(e) => setBeamNoStart(e.target.value)}
              />
            </div>
            <div>
              <label className="label text-xs">No. of beams</label>
              <input
                type="number"
                min={1}
                className="input w-20"
                value={beamGenCount}
                onChange={(e) => setBeamGenCount(e.target.value)}
              />
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={generateBeamRows}>
              Generate beams
            </button>
          </div>
          <div className="space-y-2">
            {beamRows.map((b, idx) => (
```

The rest of the beam-row list (the `.map(...)` body, remove `×` button, and the existing "+ Add beam" link at lines 2477-2479) is unchanged — generated rows land in the same `beamRows` state and stay editable per-row exactly like manually-added ones.

- [ ] **Step 2: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual walkthrough**

Run: `cd app && npm run dev`, open `/app/jobwork`, open "Add warp beam given" for a jobwork party. Type `101` in "Beam No starting" and `4` in "No. of beams", click "Generate beams". Expected: 4 beam rows appear with Beam No `101`, `102`, `103`, `104`, Ends/Metres blank and editable. Click "Generate beams" again with a different starting number — expected: a confirm dialog appears (since the previous rows still have blank-but-touched state only if you'd filled Ends/Metres; typing Ends/Metres into one row first will trigger the confirm on next generation). Stop the dev server after checking (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: add Generate beams control for sequential Beam No entry"
```

---

## Task 5: Save `sizing_set_no` instead of `sizing_job_id` in `add()`

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:1884-1943`

- [ ] **Step 1: Update `basePayload` — drop `sizing_job_id`, add `sizing_set_no`**

Current code (lines 1884-1892):
```typescript
      const notesTrimmed = form.notes.trim();
      const basePayload = {
        jobwork_party_id:  Number(form.jobwork_party_id),
        fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
        warp_count_id:     form.warp_count_id === '' ? null : Number(form.warp_count_id),
        given_date:        form.given_date,
        reference_no:      form.reference_no.trim() || null,
        supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
        sizing_job_id:     form.sizing_job_id === '' ? null : Number(form.sizing_job_id),
      };
```

Replace with:
```typescript
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

- [ ] **Step 2: Add `sizing_set_no` to the per-beam `pavu` insert**

Current code (lines 1901-1913):
```typescript
        const { data: newPavu, error: pavuErr } = await sb
          .from('pavu')
          .insert({
            sizing_job_id:     null,
            beam_no:           b.beamNo,
            ends,
            meters:            metres,
            production_mode:   'jobwork',
            jobwork_ledger_id: supplierLedgerId,
            status:            'in_stock',
          })
          .select('id')
          .single();
```

Replace with:
```typescript
        const { data: newPavu, error: pavuErr } = await sb
          .from('pavu')
          .insert({
            sizing_job_id:     null,
            sizing_set_no:     sizingSetNoTrimmed,
            beam_no:           b.beamNo,
            ends,
            meters:            metres,
            production_mode:   'jobwork',
            jobwork_ledger_id: supplierLedgerId,
            status:            'in_stock',
          })
          .select('id')
          .single();
```

- [ ] **Step 3: Extend the form reset to clear the new fields**

Current code (lines 1937-1944):
```typescript
      setBusy(false);
      setForm({
        given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
        total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
        sizing_job_id: '',
      });
      setBeamRows([{ beamNo: '', ends: '', metres: '' }]);
      setShowAdd(false);
```

Replace with:
```typescript
      setBusy(false);
      setForm({
        given_date: todayISO(), jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '',
        total_ends: '', beam_count: '1', total_metres: '', reference_no: '', notes: '', supplier_party_id: '',
        sizing_job_id: '', sizingSetNo: '',
      });
      setBeamRows([{ beamNo: '', ends: '', metres: '' }]);
      setBeamNoStart('');
      setBeamGenCount('1');
      setShowAdd(false);
```

- [ ] **Step 4: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Manual walkthrough**

Run: `cd app && npm run dev`, open `/app/jobwork`, add a jobwork beam with Sizing Set No `SET-9`, one beam row (Beam No `201`, Ends `4000`, Metres `3500`). Save. Then, via the Supabase MCP `execute_sql` tool, run:
```sql
select jwb.sizing_set_no as jwb_set_no, p.sizing_set_no as pavu_set_no, p.beam_no
from public.jobwork_warp_beam jwb
join public.pavu p on p.id = jwb.pavu_id
where jwb.notes like '%201%'
order by jwb.id desc
limit 1;
```
Expected: one row, both `jwb_set_no` and `pavu_set_no` equal `SET-9`.

- [ ] **Step 6: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "feat: save sizing_set_no on jobwork beam and pavu insert"
```

---

## Task 6: Remove the dead `allSizingJobs` dropdown data source

**Files:**
- Modify: `app/app/app/jobwork/page.tsx:1546`, `app/app/app/jobwork/page.tsx:1653-1670`

- [ ] **Step 1: Remove the `allSizingJobs` state declaration**

Current code (line 1546):
```typescript
  const [allSizingJobs,    setAllSizingJobs]    = useState<SizingJobOpt[]>([]);
```

Delete this line entirely (its comment on lines 1543-1545 documents exactly this dead dropdown and should be deleted along with it):
```typescript
  // Jobwork manual-entry form only: a flat, unfiltered sizing job list
  // for the "Sizing job" dropdown. No cascade, no pavu linkage — the
  // operator just records which sizing job the warp came from.
  const [allSizingJobs,    setAllSizingJobs]    = useState<SizingJobOpt[]>([]);
```

- [ ] **Step 2: Remove the effect that loaded it**

Current code (lines 1653-1670):
```typescript
  // Jobwork manual-entry form: flat, unfiltered sizing job list for the
  // "Sizing job" dropdown. No cascade, no pavu-checklist — just a plain
  // reference field (jobwork_warp_beam.sizing_job_id).
  useEffect(() => {
    if (!showAdd || kind !== 'jobwork') return;
    let cancelled = false;
    void (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const { data } = await sb
        .from('sizing_job')
        .select('id, job_code, set_no, warp_count_id, sizing_ledger_id')
        .order('created_at', { ascending: false })
        .limit(500);
      if (!cancelled) setAllSizingJobs((data ?? []) as SizingJobOpt[]);
    })();
    return () => { cancelled = true; };
  }, [showAdd, kind, supabase]);

```

Delete this entire block.

- [ ] **Step 3: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors, and no more references to `allSizingJobs` / `setAllSizingJobs` anywhere in the file. Confirm with:

Run: `grep -n "allSizingJobs" app/app/app/jobwork/page.tsx`
Expected: no output (no matches).

- [ ] **Step 4: Commit**

```bash
git add app/app/app/jobwork/page.tsx
git commit -m "chore: remove dead allSizingJobs dropdown data source"
```

---

## Task 7: Display Sizing Set No on Pavu Master's Jobwork tab

**Files:**
- Modify: `app/app/app/pavu/jobwork-beams-table.tsx`
- Modify: `app/app/app/pavu/page.tsx:75-77`, `app/app/app/pavu/page.tsx:104-141`

- [ ] **Step 1: Add `sizing_set_no` to `JobworkBeamRow`**

Current code (lines 11-25):
```typescript
export interface JobworkBeamRow {
  id: number;
  given_date: string;
  party_name: string;
  quality_name: string | null;
  warp_count_display: string | null;
  total_ends: number | null;
  beam_count: number;
  metres: number;
  /** Pavu code(s) this beam is linked to, if any — empty for manual
   *  entries (the common case; jobwork entries don't pick from Pavu). */
  pavu_codes: string[];
  /** Current status of the linked pavu row ('in_stock' | 'on_loom' | 'finished' | 'damaged' | 'scrapped'), or null if no pavu is linked (legacy manual entries). */
  pavu_status: string | null;
}
```

Replace with:
```typescript
export interface JobworkBeamRow {
  id: number;
  given_date: string;
  party_name: string;
  quality_name: string | null;
  warp_count_display: string | null;
  total_ends: number | null;
  beam_count: number;
  metres: number;
  /** Pavu code(s) this beam is linked to, if any — empty for manual
   *  entries (the common case; jobwork entries don't pick from Pavu). */
  pavu_codes: string[];
  /** Current status of the linked pavu row ('in_stock' | 'on_loom' | 'finished' | 'damaged' | 'scrapped'), or null if no pavu is linked (legacy manual entries). */
  pavu_status: string | null;
  /** Free-text sizing set no supplied by the jobwork party, or null for legacy rows saved before this field existed. */
  sizing_set_no: string | null;
}
```

- [ ] **Step 2: Add the column header**

Current code (lines 56-68):
```jsx
        <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left  px-4 py-3">ID</th>
            <th className="text-left  px-4 py-3">Date</th>
            <th className="text-left  px-4 py-3">Jobwork Party</th>
            <th className="text-left  px-4 py-3 hidden md:table-cell">Quality</th>
            <th className="text-left  px-4 py-3 hidden lg:table-cell">Warp count</th>
            <th className="text-right px-4 py-3">Ends</th>
            <th className="text-right px-4 py-3">Beams</th>
            <th className="text-right px-4 py-3">Metres</th>
                <th className="text-left px-4 py-3">Status</th>
            <th className="text-left  px-4 py-3">Pavu Code</th>
          </tr>
        </thead>
```

Replace with:
```jsx
        <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left  px-4 py-3">ID</th>
            <th className="text-left  px-4 py-3">Date</th>
            <th className="text-left  px-4 py-3">Jobwork Party</th>
            <th className="text-left  px-4 py-3 hidden md:table-cell">Quality</th>
            <th className="text-left  px-4 py-3 hidden lg:table-cell">Warp count</th>
            <th className="text-left  px-4 py-3 hidden lg:table-cell">Sizing Set No</th>
            <th className="text-right px-4 py-3">Ends</th>
            <th className="text-right px-4 py-3">Beams</th>
            <th className="text-right px-4 py-3">Metres</th>
                <th className="text-left px-4 py-3">Status</th>
            <th className="text-left  px-4 py-3">Pavu Code</th>
          </tr>
        </thead>
```

- [ ] **Step 3: Add the column cell**

Current code (lines 75-78):
```jsx
              <td className="px-4 py-2 hidden md:table-cell text-ink-soft">{r.quality_name ?? '—'}</td>
              <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.warp_count_display ?? '—'}</td>
              <td className="px-4 py-2 text-right num">{r.total_ends ?? '—'}</td>
```

Replace with:
```jsx
              <td className="px-4 py-2 hidden md:table-cell text-ink-soft">{r.quality_name ?? '—'}</td>
              <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.warp_count_display ?? '—'}</td>
              <td className="px-4 py-2 hidden lg:table-cell text-ink-soft">{r.sizing_set_no ?? '—'}</td>
              <td className="px-4 py-2 text-right num">{r.total_ends ?? '—'}</td>
```

- [ ] **Step 4: Update the footer's `colSpan`**

Current code (line 98):
```jsx
            <td colSpan={6} className="px-4 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
```

Replace with:
```jsx
            <td colSpan={7} className="px-4 py-3 text-right text-ink-soft uppercase text-[11px] tracking-wide">Total</td>
```

- [ ] **Step 5: Select `sizing_set_no` from `jobwork_warp_beam` in `pavu/page.tsx`**

Current code (lines 75-78):
```typescript
    sb.from('jobwork_warp_beam')
      .select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, beam_count, total_metres, original_metres, pavu_id, pavu_ids')
      .eq('status', 'active')
      .order('given_date', { ascending: false }),
```

Replace with:
```typescript
    sb.from('jobwork_warp_beam')
      .select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, beam_count, total_metres, original_metres, pavu_id, pavu_ids, sizing_set_no')
      .eq('status', 'active')
      .order('given_date', { ascending: false }),
```

- [ ] **Step 6: Add `sizing_set_no` to the `rawJobworkBeams` cast type**

Current code (lines 104-110):
```typescript
  const rawJobworkBeams = ((jobworkBeamsRes.data ?? []) as Array<{
    id: number; jobwork_party_id: number;
    fabric_quality_id: number | null; warp_count_id: number | null;
    given_date: string; total_ends: number | null; beam_count: number;
    total_metres: number | null; original_metres: number | null;
    pavu_id: number | null; pavu_ids: number[] | null;
  }>).filter((w) => jobworkPartyNameById.has(w.jobwork_party_id));
```

Replace with:
```typescript
  const rawJobworkBeams = ((jobworkBeamsRes.data ?? []) as Array<{
    id: number; jobwork_party_id: number;
    fabric_quality_id: number | null; warp_count_id: number | null;
    given_date: string; total_ends: number | null; beam_count: number;
    total_metres: number | null; original_metres: number | null;
    pavu_id: number | null; pavu_ids: number[] | null;
    sizing_set_no: string | null;
  }>).filter((w) => jobworkPartyNameById.has(w.jobwork_party_id));
```

- [ ] **Step 7: Map `sizing_set_no` into the `JobworkBeamRow` result**

Current code (lines 126-142):
```typescript
  const jobworkBeams: JobworkBeamRow[] = rawJobworkBeams.map((w) => {
    const ids = [w.pavu_id, ...(w.pavu_ids ?? [])].filter((id): id is number => id != null);
    const codes = ids.map((id) => pavuCodeById.get(id)).filter((c): c is string => c != null);
    const firstId = ids.length > 0 ? ids[0] : undefined;
    return {
      id: w.id,
      given_date: w.given_date,
      party_name: jobworkPartyNameById.get(w.jobwork_party_id) ?? '-',
      quality_name: w.fabric_quality_id != null ? fabricQualityNameById.get(w.fabric_quality_id) ?? null : null,
      warp_count_display: w.warp_count_id != null ? warpCountDisplayById.get(w.warp_count_id) ?? null : null,
      total_ends: w.total_ends,
      beam_count: w.beam_count,
      metres: Number((w.original_metres ?? w.total_metres) ?? 0),
      pavu_codes: codes,
      pavu_status: firstId != null ? (pavuStatusById.get(firstId) ?? null) : null,
    };
  });
```

Replace with:
```typescript
  const jobworkBeams: JobworkBeamRow[] = rawJobworkBeams.map((w) => {
    const ids = [w.pavu_id, ...(w.pavu_ids ?? [])].filter((id): id is number => id != null);
    const codes = ids.map((id) => pavuCodeById.get(id)).filter((c): c is string => c != null);
    const firstId = ids.length > 0 ? ids[0] : undefined;
    return {
      id: w.id,
      given_date: w.given_date,
      party_name: jobworkPartyNameById.get(w.jobwork_party_id) ?? '-',
      quality_name: w.fabric_quality_id != null ? fabricQualityNameById.get(w.fabric_quality_id) ?? null : null,
      warp_count_display: w.warp_count_id != null ? warpCountDisplayById.get(w.warp_count_id) ?? null : null,
      total_ends: w.total_ends,
      beam_count: w.beam_count,
      metres: Number((w.original_metres ?? w.total_metres) ?? 0),
      pavu_codes: codes,
      pavu_status: firstId != null ? (pavuStatusById.get(firstId) ?? null) : null,
      sizing_set_no: w.sizing_set_no,
    };
  });
```

- [ ] **Step 8: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Manual walkthrough**

Run: `cd app && npm run dev`, open Pavu Master → Jobwork tab. Expected: a "Sizing Set No" column appears (visible at `lg` breakpoint and above) showing `SET-9` for the beam saved in Task 5's walkthrough, and `—` for older rows saved before this feature. Stop the dev server (Ctrl+C).

- [ ] **Step 10: Commit**

```bash
git add app/app/app/pavu/jobwork-beams-table.tsx app/app/app/pavu/page.tsx
git commit -m "feat: display and populate Sizing Set No on Pavu Master Jobwork tab"
```

---

## Task 8: Show Sizing Set No on Loom View's jobwork tags

**Files:**
- Modify: `app/app/app/pavu/assign/page.tsx`

- [ ] **Step 1: Add `sizing_set_no` to the `ActiveAssignment.pavu` and `PavuInStock` interfaces**

Current code (lines 23-48):
```typescript
interface ActiveAssignment {
  id: number;
  loom_id: number;
  status: string;
  metres_produced: number;
  start_date: string | null;
  metres_start_date: string | null;
  pavu: {
    id: number; pavu_code: string; beam_no: string; ends: number; meters: number;
    sizing_job?: { warp_count?: { code: string } | null } | null;
    production_mode: 'in_house' | 'outsource' | 'jobwork';
    jobwork_vendor?: { name: string } | null;
  } | null;
  costing: { id: number; quality_code: string; quality_name: string } | null;
}

interface PavuInStock {
  id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  meters: number;
  sizing_job?: { set_no?: string | null; warp_count?: { code: string } | null } | null;
  production_mode: 'in_house' | 'outsource' | 'jobwork';
  jobwork_vendor?: { name: string } | null;
}
```

Replace with:
```typescript
interface ActiveAssignment {
  id: number;
  loom_id: number;
  status: string;
  metres_produced: number;
  start_date: string | null;
  metres_start_date: string | null;
  pavu: {
    id: number; pavu_code: string; beam_no: string; ends: number; meters: number;
    sizing_job?: { warp_count?: { code: string } | null } | null;
    production_mode: 'in_house' | 'outsource' | 'jobwork';
    jobwork_vendor?: { name: string } | null;
    /** Free-text sizing set no, populated for jobwork-mode pavu rows only. */
    sizing_set_no?: string | null;
  } | null;
  costing: { id: number; quality_code: string; quality_name: string } | null;
}

interface PavuInStock {
  id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  meters: number;
  sizing_job?: { set_no?: string | null; warp_count?: { code: string } | null } | null;
  production_mode: 'in_house' | 'outsource' | 'jobwork';
  jobwork_vendor?: { name: string } | null;
  /** Free-text sizing set no, populated for jobwork-mode pavu rows only. */
  sizing_set_no?: string | null;
}
```

- [ ] **Step 2: Select `sizing_set_no` in both `pavu` queries**

Current code (lines 96-116):
```typescript
      supabase.from('pavu_assign')
        .select(`
          id, loom_id, status, metres_produced, start_date, metres_start_date,
          pavu:pavu_id (
            id, pavu_code, beam_no, ends, meters, production_mode,
            sizing_job:sizing_job_id ( warp_count:warp_count_id ( code ) ),
            jobwork_vendor:jobwork_ledger_id ( name )
          ),
          costing:costing_id ( id, quality_code, quality_name )
        `)
        .in('status', ['queued', 'mounted', 'running']),
      sb.from('pavu')
        .select(`
          id, pavu_code, beam_no, ends, meters, production_mode,
          sizing_job:sizing_job_id ( set_no, warp_count:warp_count_id ( code ) ),
          jobwork_vendor:jobwork_ledger_id ( name )
        `)
        .eq('status', 'in_stock')
        .in('production_mode', ['in_house', 'jobwork'])
        .order('created_at', { ascending: false })
        .limit(100),
```

Replace with:
```typescript
      supabase.from('pavu_assign')
        .select(`
          id, loom_id, status, metres_produced, start_date, metres_start_date,
          pavu:pavu_id (
            id, pavu_code, beam_no, ends, meters, production_mode, sizing_set_no,
            sizing_job:sizing_job_id ( warp_count:warp_count_id ( code ) ),
            jobwork_vendor:jobwork_ledger_id ( name )
          ),
          costing:costing_id ( id, quality_code, quality_name )
        `)
        .in('status', ['queued', 'mounted', 'running']),
      sb.from('pavu')
        .select(`
          id, pavu_code, beam_no, ends, meters, production_mode, sizing_set_no,
          sizing_job:sizing_job_id ( set_no, warp_count:warp_count_id ( code ) ),
          jobwork_vendor:jobwork_ledger_id ( name )
        `)
        .eq('status', 'in_stock')
        .in('production_mode', ['in_house', 'jobwork'])
        .order('created_at', { ascending: false })
        .limit(100),
```

- [ ] **Step 3: Append the set no to the mounted-loom card's jobwork tag**

Current code (lines 231-235):
```jsx
                    {cur.pavu.production_mode === 'jobwork' && (
                      <div className="text-xs text-indigo-700 mt-1">
                        Jobwork beam — supplied by {cur.pavu.jobwork_vendor?.name ?? 'Unknown party'}
                      </div>
                    )}
```

Replace with:
```jsx
                    {cur.pavu.production_mode === 'jobwork' && (
                      <div className="text-xs text-indigo-700 mt-1">
                        Jobwork beam — supplied by {cur.pavu.jobwork_vendor?.name ?? 'Unknown party'}
                        {cur.pavu.sizing_set_no ? ` (Set ${cur.pavu.sizing_set_no})` : ''}
                      </div>
                    )}
```

- [ ] **Step 4: Append the set no to the stock-picker dropdown option**

Current code (lines 429-435):
```jsx
              {filteredStock.map(s => (
                <option key={s.id} value={s.id}>
                  {s.pavu_code} — Beam {s.beam_no} · {s.sizing_job?.warp_count?.code ?? ''} · {s.ends} ends · {Number(s.meters).toFixed(0)} m
                  {s.sizing_job?.set_no ? ` · Set ${s.sizing_job.set_no}` : ''}
                  {s.production_mode === 'jobwork' ? ` · Jobwork (${s.jobwork_vendor?.name ?? 'Unknown party'})` : ''}
                </option>
              ))}
```

Replace with:
```jsx
              {filteredStock.map(s => (
                <option key={s.id} value={s.id}>
                  {s.pavu_code} — Beam {s.beam_no} · {s.sizing_job?.warp_count?.code ?? ''} · {s.ends} ends · {Number(s.meters).toFixed(0)} m
                  {s.sizing_job?.set_no ? ` · Set ${s.sizing_job.set_no}` : ''}
                  {s.production_mode === 'jobwork' ? ` · Jobwork (${s.jobwork_vendor?.name ?? 'Unknown party'}${s.sizing_set_no ? `, Set ${s.sizing_set_no}` : ''})` : ''}
                </option>
              ))}
```

- [ ] **Step 5: Verify with typecheck**

Run: `cd app && npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Manual walkthrough**

Run: `cd app && npm run dev`, open Loom View (`/app/pavu/assign`). In the "Assign" modal for any loom, confirm the in-stock dropdown shows `· Jobwork (Party Name, Set SET-9)` for the beam saved earlier. Assign it, and confirm the mounted-loom card shows `Jobwork beam — supplied by Party Name (Set SET-9)`. Stop the dev server (Ctrl+C).

- [ ] **Step 7: Commit**

```bash
git add app/app/app/pavu/assign/page.tsx
git commit -m "feat: show Sizing Set No in Loom View jobwork tags"
```

---

## Task 9: Final verification and push

**Files:** None (verification only)

- [ ] **Step 1: Full typecheck**

Run: `cd app && npm run typecheck`
Expected: exits with no errors.

- [ ] **Step 2: Confirm no leftover references to the removed dropdown**

Run: `grep -rn "allSizingJobs\|SizingJobOpt" app/app/app/jobwork/page.tsx`
Expected: `SizingJobOpt` still appears (used by the untouched outsource-flow `sizingJobs` state) but `allSizingJobs` does not appear at all.

- [ ] **Step 3: Confirm the outsource flow is untouched**

Run: `grep -n "form.sizing_job_id" app/app/app/jobwork/page.tsx`
Expected: only matches inside the outsource branch (the cascading "Sizing job *" dropdown and its disabled/eligibleSizingJobs logic) — no matches inside the jobwork branch's `basePayload` or JSX (both were replaced in Tasks 3 and 5).

- [ ] **Step 4: git status check**

Run: `git status`
Expected: clean working tree (everything committed across Tasks 1-9).

- [ ] **Step 5: Push**

Run: `git push`
Expected: push succeeds; local and remote branch heads match (`git rev-parse HEAD` equals `git rev-parse @{u}`).
