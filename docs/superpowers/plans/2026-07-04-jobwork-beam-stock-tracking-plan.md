# Jobwork Beam Stock Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a jobwork party supplies a ready-made warp beam, creating the "Warp beam given" entry on `/app/jobwork` must also create a real `pavu` stock row (production_mode = `jobwork`) so the beam shows up as available stock on Loom View and can be mounted on a mill loom, tracked, and delivered back as finished fabric via DC + job-work invoice.

**Architecture:** Extend `pavu.sizing_job_id` to be nullable (jobwork beams have no sizing job). Change the jobwork beam-wise `add()` handler in `jobwork/page.tsx` to insert a `pavu` row per beam (linked via `pavu_id`) instead of a bare `jobwork_warp_beam` row. Broaden the Loom View stock query in `pavu/assign/page.tsx` to include `production_mode IN ('in_house','jobwork')`, tagging jobwork beams with their supplying party. Remove the now-incorrect read-only "Jobwork beams out with parties" section (jobwork beams weave in-house now, not at the party). Add a Status column to the Jobwork tab's beam table. Remove the dead "route to jobwork party" mode from Pavu Master's list editor, since the jobwork beam is now only ever created from `/app/jobwork`.

**Tech Stack:** Next.js App Router (`ppk_tex_erp/app`), Supabase/Postgres, TypeScript, Tailwind. Migrations applied via Supabase MCP `apply_migration` (project_id `cqyfbiecramujnzhgieg`).

---

## Task 1: Migration 231 — make `pavu.sizing_job_id` nullable

**Files:**
- Create: `db/migrations/231_pavu_jobwork_sizing_optional.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 231_pavu_jobwork_sizing_optional.sql
--
-- Jobwork beams (production_mode = 'jobwork') are now created directly by
-- the beam-wise "Warp beam given" form on /app/jobwork, one pavu row per
-- physical beam supplied by the jobwork party. These beams have no sizing
-- job — the mill didn't size them, the party delivered a ready-made beam —
-- so pavu.sizing_job_id (previously NOT NULL) must become optional.
--
-- Also repurposes pavu.jobwork_ledger_id (added in migration 230): it
-- previously meant "the jobwork_party this beam was routed OUT to" (mirroring
-- outsource). It now means "the jobwork_party that SUPPLIED this beam" — the
-- inbound direction is the only real jobwork flow at this mill. No column or
-- type change needed, only the meaning + the comment below.

ALTER TABLE public.pavu ALTER COLUMN sizing_job_id DROP NOT NULL;

COMMENT ON COLUMN public.pavu.jobwork_ledger_id IS
  'Set when production_mode = jobwork: the jobwork_party.ledger_id (kind=jobwork) that SUPPLIED this beam for in-house weaving. The mill mounts the beam on its own loom and delivers finished fabric back to this party via a DC + job-work invoice. (Repurposed by migration 231 — previously meant the party the beam was sent OUT to, mirroring outsource; that direction turned out not to reflect how jobwork actually works at this mill.)';
```

- [ ] **Step 2: Apply the migration via Supabase MCP**

Call the Supabase MCP `apply_migration` tool with:
```
project_id: cqyfbiecramujnzhgieg
name: pavu_jobwork_sizing_optional
query: <the SQL body above, without the leading comment-only header lines stripped — pass the file's SQL statements as-is>
```

- [ ] **Step 3: Verify via `execute_sql`**

Run this query through the Supabase MCP `execute_sql` tool:

```sql
select column_name, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = 'pavu' and column_name = 'sizing_job_id';
```

Expected: `is_nullable = 'YES'`.

Also run:

```sql
select col_description('public.pavu'::regclass, (
  select attnum from pg_attribute where attrelid = 'public.pavu'::regclass and attname = 'jobwork_ledger_id'
));
```

Expected: the new comment text starting with "Set when production_mode = jobwork: the jobwork_party.ledger_id (kind=jobwork) that SUPPLIED this beam...".

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add db/migrations/231_pavu_jobwork_sizing_optional.sql
git commit -m "db: make pavu.sizing_job_id nullable for jobwork beams (migration 231)"
```

---

## Task 2: `jobwork/page.tsx` — create a linked pavu row per beam

**Files:**
- Modify: `app/app/app/jobwork/page.tsx` (the `add()` function's `kind === 'jobwork'` branch, currently lines 1848-1904)

- [ ] **Step 1: Replace the `kind === 'jobwork'` branch in `add()`**

Find this exact current block:

```tsx
      if (kind === 'jobwork') {
        // Manual, beam-wise entry — no beam picker, no pavu link, no
        // pavu-table side effects at all. Each typed beam row becomes its
        // own jobwork_warp_beam row (beam_count=1) sharing the rest of
        // the form's fields; the beam number is folded into notes since
        // the table has no beam-number column.
        const beams = beamRows
          .map((b) => ({ beamNo: b.beamNo.trim(), ends: b.ends, metres: b.metres }))
          .filter((b) => b.beamNo !== '' && b.ends !== '' && b.metres !== '');
        if (beams.length === 0) {
          setErr('Enter the beam no., ends and metres for at least one beam.');
          return;
        }
        setBusy(true);
        const sb = supabase as any;
        const notesTrimmed = form.notes.trim();
        const basePayload = {
          jobwork_party_id:  Number(form.jobwork_party_id),
          fabric_quality_id: form.fabric_quality_id === '' ? null : Number(form.fabric_quality_id),
          warp_count_id:     form.warp_count_id === '' ? null : Number(form.warp_count_id),
          given_date:        form.given_date,
          reference_no:      form.reference_no.trim() || null,
          supplier_party_id: form.supplier_party_id === '' ? null : Number(form.supplier_party_id),
          sizing_job_id:     form.sizing_job_id === '' ? null : Number(form.sizing_job_id),
          pavu_id:           null,
          pavu_ids:          null,
        };
        const payloads = beams.map((b) => {
          const metres = Number(b.metres);
          const beamNote = `Beam No ${b.beamNo}`;
          return {
            ...basePayload,
            total_ends:      Number(b.ends),
            beam_count:      1,
            total_metres:    metres,
            original_metres: metres,
            notes:           notesTrimmed ? `${beamNote} — ${notesTrimmed}` : beamNote,
          };
        });
        const { error: insErr } = await sb.from('jobwork_warp_beam').insert(payloads);
        setBusy(false);
        if (insErr) { setErr(insErr.message); return; }
        setForm({
          jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '', given_date: today(),
          reference_no: '', supplier_party_id: '', sizing_job_id: '', notes: '',
        });
        setBeamRows([{ beamNo: '', ends: '', metres: '' }]);
        setShowAdd(false);
        onChanged();
        return;
      }
```

Note: confirm the exact `setForm({...})` reset shape in the live file before editing (field list above is taken from the confirmed research read — if the live file differs, keep the reset shape from the live file unchanged and only replace the logic above it).

Replace it with:

```tsx
      if (kind === 'jobwork') {
        // Beam-wise entry — one physical warp beam supplied by the jobwork
        // party per row. Each beam becomes BOTH a jobwork_warp_beam
        // "warp given" record AND a real pavu stock row (production_mode
        // = 'jobwork', sizing_job_id = null — the mill didn't size this
        // beam, the party delivered it ready-made) so it shows up as
        // available stock on Loom View / the Beam Stock Report exactly
        // like an in-house beam, and can be mounted on a loom.
        const beams = beamRows
          .map((b) => ({ beamNo: b.beamNo.trim(), ends: b.ends, metres: b.metres }))
          .filter((b) => b.beamNo !== '' && b.ends !== '' && b.metres !== '');
        if (beams.length === 0) {
          setErr('Enter the beam no., ends and metres for at least one beam.');
          return;
        }
        setBusy(true);
        const sb = supabase as any;

        const { data: party } = await sb
          .from('jobwork_party')
          .select('ledger_id')
          .eq('id', Number(form.jobwork_party_id))
          .maybeSingle();
        if (!party?.ledger_id) {
          setBusy(false);
          setErr('Selected party has no linked ledger. Set it up on the party form first.');
          return;
        }
        const supplierLedgerId = Number(party.ledger_id);

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

        for (const b of beams) {
          const metres = Number(b.metres);
          const ends = Number(b.ends);
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
          if (pavuErr || !newPavu) {
            setBusy(false);
            setErr(`Could not create stock row for beam ${b.beamNo}: ${pavuErr?.message ?? 'unknown error'}`);
            return;
          }
          const beamNote = `Beam No ${b.beamNo}`;
          const { error: insErr } = await sb.from('jobwork_warp_beam').insert({
            ...basePayload,
            total_ends:      ends,
            beam_count:      1,
            total_metres:    metres,
            original_metres: metres,
            notes:           notesTrimmed ? `${beamNote} — ${notesTrimmed}` : beamNote,
            pavu_id:         newPavu.id,
            pavu_ids:        null,
          });
          if (insErr) {
            setBusy(false);
            setErr(`Stock row created but the warp-given entry for beam ${b.beamNo} failed: ${insErr.message}`);
            return;
          }
        }

        setBusy(false);
        setForm({
          jobwork_party_id: '', fabric_quality_id: '', warp_count_id: '', given_date: today(),
          reference_no: '', supplier_party_id: '', sizing_job_id: '', notes: '',
        });
        setBeamRows([{ beamNo: '', ends: '', metres: '' }]);
        setShowAdd(false);
        onChanged();
        return;
      }
```

Sequential inserts (not a single bulk insert) are used deliberately so each beam's newly created `pavu.id` can be captured and written into that same beam's `jobwork_warp_beam.pavu_id` — a bulk `INSERT ... RETURNING` does not guarantee row-order correspondence with the input array.

- [ ] **Step 2: Typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

Expected: no errors related to `jobwork/page.tsx`.

- [ ] **Step 3: Manual smoke test**

Open `/app/jobwork`, add a beam under a jobwork party with a beam no., ends, and metres. Confirm:
- No error is shown.
- The new row appears in the "Warp beam given" list with a Pavu Code populated (once Task 4/5 land, a Status pill too).
- In the Supabase table editor (or via `execute_sql`), confirm a new `pavu` row exists with `production_mode = 'jobwork'`, `sizing_job_id IS NULL`, `status = 'in_stock'`, and `jobwork_ledger_id` set to the party's ledger id.

- [ ] **Step 4: Commit**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add app/app/app/jobwork/page.tsx
git commit -m "feat(jobwork): create a linked pavu stock row per beam given by a jobwork party"
```

---

## Task 3: `jobwork/page.tsx` — hide the Release button for jobwork rows

**Files:**
- Modify: `app/app/app/jobwork/page.tsx` (`renderMobileCard()` around line 2193, `renderDesktopRow()` around line 2288)

Once every new jobwork row has a linked pavu (Task 2), the beam can be mounted on a mill loom via `/app/pavu/assign`. The existing `release()` function reverts a pavu's status back to `in_stock` and deletes the `jobwork_warp_beam` row — correct for the outsource flow, but unsafe here if the linked pavu is actively mounted on a loom (it would desync from the real `pavu_assign` state). Rather than changing the shared `release()` logic (which the outsource flow already relies on correctly), hide the Release button in the UI specifically for `kind === 'jobwork'`.

- [ ] **Step 1: Update the mobile card's Release button guard**

Find (in `renderMobileCard()`):

```tsx
              {hasPavu && (
```

immediately preceding the Release button's JSX. Replace with:

```tsx
              {hasPavu && kind !== 'jobwork' && (
                /* Jobwork beams are mounted on the mill's own loom via
                   /app/pavu/assign; releasing here would desync from the
                   real pavu_assign state, so Release is outsource-only. */
```

Note: if the existing block already opens with a comment or the JSX begins on the same line, preserve the original JSX content between the guard and its closing `)}` — only the boolean condition changes, add the explanatory comment as its own line directly under the new condition.

- [ ] **Step 2: Update the desktop row's Release button guard**

Apply the identical change in `renderDesktopRow()`:

```tsx
              {hasPavu && kind !== 'jobwork' && (
                /* Jobwork beams are mounted on the mill's own loom via
                   /app/pavu/assign; releasing here would desync from the
                   real pavu_assign state, so Release is outsource-only. */
```

- [ ] **Step 3: Typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

- [ ] **Step 4: Manual smoke test**

On `/app/jobwork`, confirm a jobwork-party row with a linked pavu shows no Release button (mobile and desktop views), while an outsource-party row with a linked pavu still shows Release as before.

- [ ] **Step 5: Commit**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add app/app/app/jobwork/page.tsx
git commit -m "feat(jobwork): hide Release action for jobwork beams (mounted via pavu/assign instead)"
```

---

## Task 4: `jobwork-beams-table.tsx` — add a Status column

**Files:**
- Modify: `app/app/app/pavu/jobwork-beams-table.tsx`

- [ ] **Step 1: Add `pavu_status` to the row interface**

Find:

```tsx
export interface JobworkBeamRow {
```

Add a new field inside the interface (place it near the existing pavu-related fields):

```tsx
  /** Current status of the linked pavu row ('in_stock' | 'on_loom' | 'finished' | 'damaged' | 'scrapped'), or null if no pavu is linked (legacy manual entries). */
  pavu_status: string | null;
```

- [ ] **Step 2: Add a status style map**

Near the top of the file, after the existing imports/type declarations, add:

```tsx
const STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  on_loom:  'bg-indigo-50 text-indigo-700',
  finished: 'bg-slate-100 text-slate-600',
  damaged:  'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};
```

- [ ] **Step 3: Insert the Status header column**

Find the `<th>Pavu Code</th>` header cell and insert a new `<th>` immediately before it:

```tsx
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Pavu Code</th>
```

- [ ] **Step 4: Insert the Status body cell**

Find the `<td>` that renders the Pavu Code value and insert a new `<td>` immediately before it, rendering a pill or an em-dash:

```tsx
                  <td className="px-4 py-3">
                    {row.pavu_status ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[row.pavu_status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {row.pavu_status.replace('_', ' ')}
                      </span>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
```

- [ ] **Step 5: Update the `tfoot` column count**

Find the `tfoot` row's trailing single empty cell:

```tsx
                <td />
```

(the one trailing cell after the totals, at the end of the footer row) and change it to two empty cells, since the table now has 10 columns instead of 9:

```tsx
                <td />
                <td />
```

- [ ] **Step 6: Typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

Expected: any callers of `JobworkBeamRow` that don't yet supply `pavu_status` will now show a type error — this is expected and resolved in Task 5.

- [ ] **Step 7: Commit (combined with Task 5, since callers must be updated together)**

Do not commit yet — commit at the end of Task 5 once both the table and its data source (`pavu/page.tsx`) are updated together, so the app doesn't sit in a broken intermediate state.

---

## Task 5: `pavu/page.tsx` — populate `pavu_status` and remove dead jobwork-party plumbing

**Files:**
- Modify: `app/app/app/pavu/page.tsx`

- [ ] **Step 1: Extend the linked-pavu lookup to include status**

Find:

```tsx
      const linkedPavuIds = Array.from(new Set(
        rawJobworkBeams.flatMap((w) => [w.pavu_id, ...(w.pavu_ids ?? [])]).filter((id): id is number => id != null)
      ));
      const pavuCodeById = new Map<number, string>();
      if (linkedPavuIds.length > 0) {
        const { data: linkedPavus } = await sb.from('pavu').select('id, pavu_code').in('id', linkedPavuIds);
        for (const row of (linkedPavus ?? []) as Array<{ id: number; pavu_code: string }>) {
          pavuCodeById.set(row.id, row.pavu_code);
        }
      }
```

Replace with:

```tsx
      const linkedPavuIds = Array.from(new Set(
        rawJobworkBeams.flatMap((w) => [w.pavu_id, ...(w.pavu_ids ?? [])]).filter((id): id is number => id != null)
      ));
      const pavuCodeById = new Map<number, string>();
      const pavuStatusById = new Map<number, string>();
      if (linkedPavuIds.length > 0) {
        const { data: linkedPavus } = await sb.from('pavu').select('id, pavu_code, status').in('id', linkedPavuIds);
        for (const row of (linkedPavus ?? []) as Array<{ id: number; pavu_code: string; status: string }>) {
          pavuCodeById.set(row.id, row.pavu_code);
          pavuStatusById.set(row.id, row.status);
        }
      }
```

- [ ] **Step 2: Populate `pavu_status` in the `jobworkBeams` mapping**

Find the object returned inside the `jobworkBeams` mapping (the one built from `rawJobworkBeams`, containing `pavu_code` derived via `ids[0]` or similar). Add a sibling field:

```tsx
        pavu_status: ids.length > 0 ? (pavuStatusById.get(ids[0]) ?? null) : null,
```

Place it directly adjacent to wherever `pavu_code` is set in that same object literal (same `ids` variable already in scope from the existing `pavu_code` lookup).

- [ ] **Step 3: Remove the dead `jobworkParties` const**

Find:

```tsx
  const jobworkParties = ((jobworkPartiesRes.data ?? []) as Array<{ id: number; name: string; ledger_id: number | null }>)
    .filter((p) => p.ledger_id != null)
    .map<WeavingVendor>((p) => ({ id: p.ledger_id as number, name: p.name }));
```

Delete these lines entirely. Do not remove `jobworkPartiesRes`, `jobworkPartyRows`, or `jobworkPartyNameById` — those remain in use for the Jobwork tab's party-name display.

- [ ] **Step 4: Remove the `jobworkParties` prop from `PavuListEditor`**

Find:

```tsx
                <PavuListEditor rows={tabPavus} vendors={vendors} jobworkParties={jobworkParties} scope={tab} />
```

Replace with:

```tsx
                <PavuListEditor rows={tabPavus} vendors={vendors} scope={tab} />
```

- [ ] **Step 5: Typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

Expected: errors about the removed `jobworkParties` prop will surface here and be resolved once Task 7 removes the prop from `PavuListEditorProps`. If Task 7 hasn't landed yet in your working session, expect a transient type error on this prop — proceed to Task 7 before considering Task 5 fully verified.

- [ ] **Step 6: Manual smoke test**

Open `/app/pavu`, switch to the Jobwork tab. Confirm the beam table renders with the new Status column, showing a colored pill for beams created after Task 2 lands, and an em-dash for older legacy rows with no linked pavu.

- [ ] **Step 7: Commit**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add app/app/app/pavu/jobwork-beams-table.tsx app/app/app/pavu/page.tsx
git commit -m "feat(pavu): show linked pavu status on the Jobwork tab's beam table"
```

---

## Task 6: `pavu/assign/page.tsx` — surface jobwork beams as loom-mountable stock

**Files:**
- Modify: `app/app/app/pavu/assign/page.tsx`

This is the main Loom View file. Jobwork beams must now appear as regular mountable stock (tagged with the supplying party), and the old read-only "beams out with parties" section must be removed since jobwork beams weave in-house now.

- [ ] **Step 1: Remove the `JobworkBeamsTable` import**

Find:

```tsx
import { JobworkBeamsTable, type JobworkBeamRow } from '../jobwork-beams-table';
```

Delete this line.

- [ ] **Step 2: Extend `ActiveAssignment` and `PavuInStock` interfaces**

In `ActiveAssignment`'s `pavu` sub-object, add:

```tsx
    production_mode: 'in_house' | 'outsource' | 'jobwork';
    jobwork_vendor?: { name: string } | null;
```

In `PavuInStock`, add the same two fields:

```tsx
  production_mode: 'in_house' | 'outsource' | 'jobwork';
  jobwork_vendor?: { name: string } | null;
```

- [ ] **Step 3: Simplify `reload()`'s query list from 8 to 4**

Find:

```tsx
    const [l, a, p, q, jp, jb, fq, yc] = await Promise.all([
```

Replace the destructured variable list with:

```tsx
    const [l, a, p, q] = await Promise.all([
```

Remove the four query array entries corresponding to `jp`, `jb`, `fq`, `yc` from the `Promise.all([...])` array — keep only the first four entries (looms, active assignments, stock, and whichever fourth query already existed for `q`).

- [ ] **Step 4: Broaden the stock query to include jobwork beams**

Find, in the stock query (the one populating `p`):

```tsx
      .eq('status', 'in_stock').eq('production_mode', 'in_house')
```

Replace with:

```tsx
      .eq('status', 'in_stock').in('production_mode', ['in_house', 'jobwork'])
```

In the same query's `.select(...)` call, add the jobwork vendor join alongside existing embedded selects:

```tsx
      jobwork_vendor:jobwork_ledger_id ( name )
```

Add this as a new line inside the existing select string, in the same style as other embedded relations already selected there (e.g. alongside `sizing_job` or similar existing joins).

- [ ] **Step 5: Add the same jobwork vendor join to the active-assignment pavu select**

Find the `pavu_assign` query's embedded pavu select (the one populating `a`, used to build `ActiveAssignment[]`). Add the same embedded relation:

```tsx
        jobwork_vendor:jobwork_ledger_id ( name )
```

alongside the other fields already selected on the nested `pavu` object.

- [ ] **Step 6: Remove the jp/jb/fq/yc queries and the jobworkBeams-building block**

Delete the four now-unused query definitions (`jp`, `jb`, `fq`, `yc` — the jobwork-party, jobwork-beam, fabric-quality, warp-count queries formerly feeding the removed section) from wherever they were defined in `reload()`.

Delete the entire block that built the jobworkBeams data for the removed section: `jobworkPartyNameById`, `fabricQualityNameById`, `warpCountDisplayById`, `rawJobworkBeams`, `linkedPavuIds`, `pavuCodeById`, and the trailing `setJobworkBeams(...)` call.

- [ ] **Step 7: Remove the `jobworkBeams` state**

Find the `useState<JobworkBeamRow[]>` declaration for `jobworkBeams`/`setJobworkBeams` near the top of the component. Delete it.

- [ ] **Step 8: Remove the unused `sb = supabase as any` cast if no longer needed**

Check whether `supabase as any` is still used elsewhere in the file (e.g. by the `AssignModal` submit logic or other queries). If it is still used, leave the cast and its comment in place. If the removed jp/jb/fq/yc queries were its only remaining use, delete the cast and its comment:

```tsx
  // ... comment lines here ...
  const sb = supabase as any;
```

Only delete this if a build/typecheck confirms `sb` is unused after the removals above.

- [ ] **Step 9: Remove the "Jobwork beams out with parties" section**

Find:

```tsx
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-ink-mute uppercase tracking-wide mb-2">
            Jobwork beams out with parties
          </h2>
          <p className="text-xs text-ink-mute mb-3">
            Read-only — these beams weave on the party&apos;s own looms, not the mill&apos;s. Manage them on{' '}
            <a href="/app/jobwork" className="underline font-semibold">Job Work → Warp beam given</a>.
          </p>
          <JobworkBeamsTable rows={jobworkBeams} />
        </div>
```

Delete this entire block. Jobwork beams now weave on the mill's own loom, so they belong in the regular stock/mounted sections above, not in a separate read-only section.

- [ ] **Step 10: Update the empty-state message**

Find:

```tsx
        {looms.length > 0 && stock.length === 0 && (
          <div className="card p-4 mt-4 text-sm text-amber-700 bg-amber-50/40">
            No in-house pavu in stock. Create a{' '}
            <a href="/app/sizing/new" className="underline font-semibold">new sizing job</a>{' '}
            with in-house beams first.
          </div>
        )}
```

Replace with:

```tsx
        {looms.length > 0 && stock.length === 0 && (
          <div className="card p-4 mt-4 text-sm text-amber-700 bg-amber-50/40">
            No pavu in stock. Create a{' '}
            <a href="/app/sizing/new" className="underline font-semibold">new sizing job</a>{' '}
            with in-house beams, or record a{' '}
            <a href="/app/jobwork" className="underline font-semibold">warp beam given</a>{' '}
            by a jobwork party first.
          </div>
        )}
```

- [ ] **Step 11: Tag jobwork beams on the mounted-loom card**

Find the mounted-loom card's "Beam ... m" line (the line rendering `cur.pavu.beam_no` and metres, immediately before the `cur.costing` block). Add a conditional tag directly after it:

```tsx
                  {cur.pavu.production_mode === 'jobwork' && (
                    <div className="text-xs text-indigo-700 mt-1">
                      Jobwork beam — supplied by {cur.pavu.jobwork_vendor?.name ?? 'Unknown party'}
                    </div>
                  )}
```

- [ ] **Step 12: Tag jobwork beams in the AssignModal's pavu option label**

Find:

```tsx
              {filteredStock.map(s => (
                <option key={s.id} value={s.id}>
                  {s.pavu_code} — Beam {s.beam_no} · {s.sizing_job?.warp_count?.code ?? ''} · {s.ends} ends · {Number(s.meters).toFixed(0)} m
                  {s.sizing_job?.set_no ? ` · Set ${s.sizing_job.set_no}` : ''}
                </option>
              ))}
```

Replace with:

```tsx
              {filteredStock.map(s => (
                <option key={s.id} value={s.id}>
                  {s.pavu_code} — Beam {s.beam_no} · {s.sizing_job?.warp_count?.code ?? ''} · {s.ends} ends · {Number(s.meters).toFixed(0)} m
                  {s.sizing_job?.set_no ? ` · Set ${s.sizing_job.set_no}` : ''}
                  {s.production_mode === 'jobwork' ? ` · Jobwork (${s.jobwork_vendor?.name ?? 'Unknown party'})` : ''}
                </option>
              ))}
```

- [ ] **Step 13: Typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

Expected: no errors. If `JobworkBeamRow` or `JobworkBeamsTable` are still referenced anywhere in this file, remove the remaining reference.

- [ ] **Step 14: Manual smoke test**

Open `/app/pavu/assign`. Confirm:
- A jobwork beam created in Task 2 appears in the stock dropdown, suffixed with "· Jobwork (Party Name)".
- Mounting it on a loom works normally.
- Once mounted, the loom card shows the "Jobwork beam — supplied by ..." tag.
- The old "Jobwork beams out with parties" section is gone.
- The empty-state message (when stock is empty) mentions both sizing jobs and jobwork beam-given as sources.

- [ ] **Step 15: Commit**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add app/app/app/pavu/assign/page.tsx
git commit -m "feat(loom-view): treat jobwork beams as mountable mill stock, tagged with supplying party"
```

---

## Task 7: `pavu-list-editor.tsx` — remove the dead "route to jobwork party" mode

**Files:**
- Modify: `app/app/app/pavu/pavu-list-editor.tsx`

`PavuListEditor` is only ever rendered from `pavu/page.tsx` with `scope` equal to `'inhouse'` or `'outsource'` (confirmed: the `tab === 'jobwork'` branch renders `JobworkBeamsTable` instead and never reaches the `PavuListEditor` call). This means every `scope === 'jobwork'` branch inside `pavu-list-editor.tsx`, and the manual "Jobwork" mode option in its per-row editor, is unreachable dead code. Since jobwork beams are now only ever created from `/app/jobwork` (Task 2), this manual entry point should be removed to avoid a second, inconsistent way of creating jobwork pavu rows (one that bypasses `jobwork_warp_beam` entirely).

- [ ] **Step 1: Narrow `ProdMode`**

Find:

```tsx
type ProdMode = 'in_house' | 'outsource' | 'jobwork';
```

Replace with:

```tsx
type ProdMode = 'in_house' | 'outsource';
```

- [ ] **Step 2: Remove `jobworkPartyId` from `RowState`**

Find, inside the `RowState` interface:

```tsx
  jobworkPartyId: string;
```

Delete this line.

- [ ] **Step 3: Update `defaultStateFor()`'s fallback**

Find the line in `defaultStateFor()` that sets `mode` from `r.production_mode`. Update it to defensively fall back to `in_house` if a legacy row still has `production_mode === 'jobwork'` (so the editor never crashes on old data):

```tsx
    mode: r.production_mode === 'jobwork' ? 'in_house' : r.production_mode,
```

Also remove any `jobworkPartyId: ...` initializer in the same returned object literal.

- [ ] **Step 4: Remove the jobwork validation block in `handleSave()`**

Find:

```tsx
      if (s.mode === 'jobwork' && !s.jobworkPartyId) {
```

Delete this entire `if` block (condition + body).

- [ ] **Step 5: Simplify the payload ternary in `handleSave()`**

Find the three-way in_house/outsource/jobwork payload ternary (around lines 128-132 in the pre-change file). Replace it with a two-way in_house/outsource ternary, dropping the `jobwork_ledger_id` field entirely from the payload construction:

```tsx
        ...(s.mode === 'outsource'
          ? { outsource_ledger_id: Number(s.vendorId) || null }
          : { outsource_ledger_id: null }),
```

(Use whatever the existing two surviving branches' exact field-setting code already is for `in_house`/`outsource` — keep that code unchanged, only remove the third `jobwork` branch and its `jobwork_ledger_id` assignment.)

- [ ] **Step 6: Remove the jobwork header column**

Find:

```tsx
                {scope === 'outsource' && <th className="text-left px-4 py-3">Weaver</th>}
                {scope === 'jobwork' && <th className="text-left px-4 py-3">Jobwork Party</th>}
```

Replace with:

```tsx
                {scope === 'outsource' && <th className="text-left px-4 py-3">Weaver</th>}
```

- [ ] **Step 7: Remove the Jobwork `<option>` from the mode select**

Find:

```tsx
                <option value="jobwork">Jobwork</option>
```

Delete this line. Also find the `onChange` handler on the same `<select>` and remove any logic there that resets/sets `jobworkPartyId` (keep the rest of the handler's in_house/outsource reset logic unchanged).

- [ ] **Step 8: Remove the `scope === 'jobwork'` body block**

Find the body block (originally lines 236-255) that renders the per-row Jobwork Party dropdown when `scope === 'jobwork'`. Delete the entire block — this is confirmed unreachable since `PavuListEditor` is never rendered with `scope='jobwork'`.

- [ ] **Step 9: Remove `jobworkParties` from `Props`**

Find, in the `Props` interface:

```tsx
  jobworkParties: ReadonlyArray<WeavingVendor>;
```

Delete this line. Also remove the corresponding destructured parameter from the component's function signature (e.g. `jobworkParties` in the props destructuring).

- [ ] **Step 10: Typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

Expected: no errors. This also resolves the transient error noted at the end of Task 5 Step 5 (the `jobworkParties` prop removal on the caller side now matches the trimmed `Props` interface here).

- [ ] **Step 11: Manual smoke test**

Open `/app/pavu`, In-house and Outsource tabs. Confirm each row's mode dropdown now only offers "In house" and "Outsource" (no "Jobwork" option), and editing/saving rows in both tabs still works as before.

- [ ] **Step 12: Commit**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add app/app/app/pavu/pavu-list-editor.tsx
git commit -m "refactor(pavu): remove dead jobwork-mode entry point from the list editor"
```

---

## Task 8: Verify restock/split/delete handlers for jobwork rows with a linked pavu (documented decision)

**Files:**
- None modified.

Confirmed via reading `jobwork/page.tsx` (`del()` at line 1998, `restock()` at line 2069, `saveSplit()` at line 2105) exactly how these three handlers behave once `pavu_id` is populated on jobwork rows by Task 2:

- `del()` (lines 1998-2005) deletes the `jobwork_warp_beam` row directly via `sb.from('jobwork_warp_beam').delete().eq('id', id)` and never touches the linked `pavu` row. Deleting a jobwork row that has a linked pavu leaves that pavu row sitting in stock, no longer referenced by any `jobwork_warp_beam` row. This is pre-existing behavior — deleting an outsource row with a linked pavu already works exactly the same way today — so it is not a regression introduced by this plan. Per the design spec's "out of scope" section (no changes to the outsource flow) and to keep this plan's diff focused on stock-tracking integration, this pre-existing limitation is left as-is. Operators should use Release (where available) rather than Delete when a pavu link exists and the beam should return to stock instead of disappearing from history.
- `restock()` (lines 2069-2088) never reads or writes `pavu` — it only inserts a brand-new `jobwork_warp_beam` row representing a fresh intake batch from the same supplier (`reference_no: 'RESTOCK-' + parent.id`). It is entirely unaffected by `pavu_id` being populated on other rows and needs no change.
- `saveSplit()` (lines 2105-2145) is only reachable from the Split button, which is only rendered when `!hasPavu` (confirmed in Task 3's review of the action-button blocks in `renderMobileCard()`/`renderDesktopRow()`). Since every new jobwork row created by Task 2 has `pavu_id` set, `hasPavu` is always true for those rows going forward, so Split is never shown for them and `saveSplit()` is never invoked against a pavu-linked jobwork row. No change needed.

- [ ] **Step 1: No-op — record the verification**

No code change is made for this task. This records the check the design spec explicitly called for ("existing restock/split/delete handlers ... need a quick check ... to confirm they behave correctly") so it isn't silently skipped: the only handler that actually mutates `pavu` is `release()` (already addressed by Task 3's UI-level Release-button change), `restock()` is structurally untouched by this plan, and `saveSplit()` is structurally unreachable for pavu-linked jobwork rows. `del()`'s pavu-orphaning behavior is called out explicitly as a pre-existing, unchanged limitation shared identically with the outsource flow.

---

## Task 9: `sync-warp-beam.ts` — no change (documented decision)

**Files:**
- None modified.

`syncWarpBeamFromPavu`/`syncWarpBeamFromPavus` in `app/app/app/pavu/sync-warp-beam.ts` contain an `isJobwork` branch that resolves a receiving `jobwork_party` and upserts a mirror `jobwork_warp_beam` row keyed by `pavu_id`, for pavu rows manually set to `production_mode = 'jobwork'` via `pavu-list-editor.tsx`'s row editor (the same mechanism removed in Task 7).

Confirmed via full read of `bulk-routing-form.tsx` that its `ProdMode` type is structurally `'in_house' | 'outsource'` only — it can never set `production_mode = 'jobwork'`, so it never triggers the `isJobwork` branch. Combined with Task 7 removing the only other caller path that could set `production_mode = 'jobwork'` via UPDATE (the list editor's Jobwork mode), the `isJobwork` branch in `sync-warp-beam.ts` becomes unreachable dead code once this plan lands.

- [ ] **Step 1: No-op — confirm no change is needed**

No code change is made to `sync-warp-beam.ts`. Rationale: the `isJobwork` branch is harmless dead code post-Task 7 (nothing will call it in a way that reaches that branch going forward), and removing it adds risk to the correctly-functioning outsource path for no behavioral benefit (YAGNI). Leaving the file untouched also avoids an unnecessary diff in a file that already works correctly for its one remaining live path (outsource).

---

## Task 10: Final verification and integration commit

**Files:**
- None (verification only, plus final commit if any Task above left work uncommitted).

- [ ] **Step 1: Full typecheck**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp\app"
npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 2: Manual end-to-end walkthrough**

1. On `/app/jobwork`, add a new jobwork-party beam (beam no., ends, metres).
2. Confirm the new row shows a Pavu Code and an "in stock" status pill.
3. On `/app/pavu`, Jobwork tab, confirm the same row appears with a Status column showing "in stock".
4. On `/app/pavu/assign` (Loom View), confirm the beam appears in the mountable-stock dropdown tagged "· Jobwork (Party Name)".
5. Mount it on a loom. Confirm the mounted-loom card shows "Jobwork beam — supplied by Party Name".
6. Back on `/app/jobwork`, confirm the Release button is hidden for this row (mobile and desktop).
7. On `/app/pavu`, In-house and Outsource tabs, confirm the per-row mode dropdown no longer offers "Jobwork".
8. Confirm the "Jobwork beams out with parties" section on Loom View no longer exists.

- [ ] **Step 3: Verify git state**

```bash
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git status
git log --oneline -8
```

Expected: working tree clean (all task commits from Tasks 1-7 present; Tasks 8 and 9 are no-op/documentation-only and produce no commit of their own), no uncommitted changes.

- [ ] **Step 4: Push and verify remote**

```bash
git push origin main
git log --oneline -1
git log --oneline origin/main -1
```

Expected: both log outputs show the same commit hash.
