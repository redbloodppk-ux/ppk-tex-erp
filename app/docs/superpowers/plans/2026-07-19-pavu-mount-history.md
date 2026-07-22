# Pavu Mount History Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Pavu Mount History" report under Reports that lists every beam mount event from `pavu_assign` in a chosen date range, with loom/shed/mode/quality/ends filters, a per-quality summary, and Excel export.

**Architecture:** A single server-component page (`app/app/app/reports/pavu-mount-history/page.tsx`), following the exact pattern already used by `app/app/app/reports/fabric-movements/page.tsx`: direct Supabase joins (no stored function), `?from`/`?to` URL params defaulting to 1st-of-month → today, in-memory post-filtering, and a standard `ExcelExportButton`. Quality is resolved from `pavu_assign.costing_id` through `costing_master` + `fabric_quality` (merge-aware — same resolution `fn_pavu_stock_report` uses), and yarn count is resolved from `sizing_job.warp_count_id` (in-house) or `jobwork_warp_beam.warp_count_id` (jobwork), mirroring the map-building pattern already used in the Assign-to-Loom modal fix. One new card is added to the Reports index.

**Tech Stack:** Next.js 14 App Router (server components), TypeScript, Supabase JS client (`@/lib/supabase/server`), Tailwind utility classes, existing shared components (`PageHeader`, `CardFilter`, `ExcelExportButton`), existing `lib/xlsx.ts` (`ExcelColumn`), existing `lib/utils.ts` (`formatMetres`).

**Verification approach (adapted for this codebase):** This repo has `vitest` configured, but it is only used for pure calculation functions under `lib/formulas/`, `lib/attendance/`, `lib/wages/`, etc. — every report page (including the template this plan follows, Fabric Movements) has zero automated tests; verification is `npx tsc --noEmit` for type safety plus direct SQL queries against the live Supabase project to confirm the data shape is correct, then a Vercel deploy check. This plan follows that same convention rather than inventing a test file that doesn't match how any other report in the app is verified. Every step below that touches data-shaping logic includes an exact SQL query to confirm expected output.

---

## File Structure

- **Create:** `app/app/app/reports/pavu-mount-history/page.tsx` — the entire report (types, data loader, page component, presentational helpers), one file, matching the single-file convention already used by `fabric-movements/page.tsx` (795 lines) and every other report in this app.
- **Modify:** `app/app/app/reports/page.tsx` — add one new entry to the `REPORTS` array (after the `fabric-movements` entry, per the design spec's Navigation section).

No new database objects, no migrations — pure read query against `pavu_assign`, `pavu`, `loom`, `costing_master`, `fabric_quality`, `sizing_job`, `jobwork_warp_beam`, `yarn_count` (all existing tables).

---

### Task 1: Report file — types, constants, helpers, data loader

**Files:**
- Create: `app/app/app/reports/pavu-mount-history/page.tsx`

- [ ] **Step 1: Write the file header, imports, types, constants, and small helpers**

```tsx
/**
 * Pavu Mount History report
 *
 * Every mount event recorded in pavu_assign, filtered to a chosen date
 * range on the MOUNT date (start_date). Complements the Beam Stock Report
 * (fn_pavu_stock_report), which only shows the CURRENT status of each
 * beam — this report is the permanent history of which beam went on
 * which loom, when it came off, and how many metres it produced.
 *
 * URL params:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (defaults: 1st of this month → today)
 *   ?loom_id=<id>
 *   ?shed=<shed_no>
 *   ?mode=in_house|jobwork|outsource
 *   ?quality_code=<text>
 *   ?ends=<number>
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import { formatMetres } from '@/lib/utils';
import type { ExcelColumn } from '@/lib/xlsx';
import { History, Layers, Gauge } from 'lucide-react';

export const metadata = { title: 'Pavu Mount History' };
export const dynamic = 'force-dynamic';

/* ─────────────── types ─────────────── */

interface MountHistoryRow {
  assign_id: number;
  pavu_id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  yarn_count: string | null;
  quality_code: string | null;
  quality_name: string | null;
  production_mode: string | null;
  loom_id: number | null;
  loom_code: string | null;
  shed_no: number | null;
  mount_date: string | null;
  unmount_date: string | null;
  days_mounted: number | null;
  metres_produced: number;
  actual_metres: number;
  status: string;
  notes: string | null;
}

interface RawAssignRow {
  id: number;
  pavu_id: number;
  loom_id: number | null;
  costing_id: number | null;
  start_date: string | null;
  end_date: string | null;
  metres_produced: number | string | null;
  actual_metres: number | string | null;
  status: string;
  notes: string | null;
  pavu: {
    id: number;
    pavu_code: string | null;
    beam_no: string | null;
    ends: number | null;
    production_mode: string | null;
    sizing_job_id: number | null;
  } | null;
  loom: { id: number; loom_code: string | null; shed_no: number | null } | null;
}

interface LoomOpt {
  id: number;
  loom_code: string;
  shed_no: number | null;
}

const MODE_LABEL: Record<string, string> = {
  in_house: 'In-house',
  outsource: 'Outsource',
  jobwork: 'Jobwork',
};

const ASSIGN_STATUS_STYLE: Record<string, string> = {
  queued: 'bg-amber-50 text-amber-700',
  mounted: 'bg-indigo-50 text-indigo-700',
  running: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-slate-100 text-slate-600',
  removed: 'bg-rose-50 text-rose-700',
};

/* ─────────────── small helpers ─────────────── */

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}
```

- [ ] **Step 2: Append the data loader**

```tsx
/* ─────────────── data loader ─────────────── */
/* Direct Supabase joins, no stored function — pavu_assign is already the
 * permanent record of every mount event, so this is a straight read plus
 * quality/yarn-count resolution, following the same pattern as the
 * Fabric Movements report.
 *
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMountHistory(supabase: any, from: string, to: string): Promise<MountHistoryRow[]> {
  const { data: assignData } = await supabase
    .from('pavu_assign')
    .select(`
      id, pavu_id, loom_id, costing_id, start_date, end_date,
      metres_produced, actual_metres, status, notes,
      pavu:pavu_id ( id, pavu_code, beam_no, ends, production_mode, sizing_job_id ),
      loom:loom_id ( id, loom_code, shed_no )
    `)
    .gte('start_date', from)
    .lte('start_date', to)
    .order('start_date', { ascending: false });

  const rows = (assignData ?? []) as RawAssignRow[];
  if (rows.length === 0) return [];

  // Quality — resolved through costing_id -> fabric_quality (merge-aware),
  // falling back to costing_master.quality_name. Same resolution as
  // fn_pavu_stock_report's primary (a_cm/fq_a/qa) branch, applied directly
  // since each pavu_assign row already carries the specific costing_id it
  // was mounted under (no "latest assign" lookup needed).
  const costingIds = Array.from(
    new Set(rows.map((r) => r.costing_id).filter((v): v is number => v != null)),
  );
  let costingById = new Map<number, { quality_code: string | null; quality_name: string | null }>();
  let fqByCostingId = new Map<number, { name: string | null; is_merged: boolean; merged_name: string | null }>();
  if (costingIds.length > 0) {
    const [cmRes, fqRes] = await Promise.all([
      supabase.from('costing_master').select('id, quality_code, quality_name').in('id', costingIds),
      supabase.from('fabric_quality').select('costing_id, name, is_merged, merged_name').in('costing_id', costingIds),
    ]);
    costingById = new Map(
      ((cmRes.data ?? []) as Array<{ id: number; quality_code: string | null; quality_name: string | null }>).map(
        (c) => [c.id, { quality_code: c.quality_code, quality_name: c.quality_name }],
      ),
    );
    fqByCostingId = new Map(
      (
        (fqRes.data ?? []) as Array<{
          costing_id: number; name: string | null; is_merged: boolean; merged_name: string | null;
        }>
      ).map((f) => [f.costing_id, { name: f.name, is_merged: f.is_merged, merged_name: f.merged_name }]),
    );
  }

  // Yarn count — in-house via pavu.sizing_job_id -> sizing_job.warp_count_id;
  // jobwork via jobwork_warp_beam (pavu_id or the pavu_ids batch array), the
  // same map-building pattern used to fix the Assign-to-Loom modal earlier
  // this session (see app/app/pavu/assign/page.tsx).
  const sizingJobIds = Array.from(
    new Set(rows.map((r) => r.pavu?.sizing_job_id).filter((v): v is number => v != null)),
  );
  let warpCountIdBySizingJob = new Map<number, number>();
  if (sizingJobIds.length > 0) {
    const { data } = await supabase.from('sizing_job').select('id, warp_count_id').in('id', sizingJobIds);
    warpCountIdBySizingJob = new Map(
      ((data ?? []) as Array<{ id: number; warp_count_id: number | null }>)
        .filter((s) => s.warp_count_id != null)
        .map((s) => [s.id, s.warp_count_id as number]),
    );
  }

  const { data: jwbData } = await supabase
    .from('jobwork_warp_beam')
    .select('pavu_id, pavu_ids, warp_count_id');
  const warpCountIdByPavu = new Map<number, number>();
  for (const row of (jwbData ?? []) as Array<{
    pavu_id: number | null; pavu_ids: number[] | null; warp_count_id: number | null;
  }>) {
    if (row.warp_count_id == null) continue;
    const ids = [row.pavu_id, ...(row.pavu_ids ?? [])].filter((id): id is number => id != null);
    for (const id of ids) warpCountIdByPavu.set(id, row.warp_count_id);
  }

  const warpCountIds = new Set<number>();
  for (const wc of warpCountIdBySizingJob.values()) warpCountIds.add(wc);
  for (const wc of warpCountIdByPavu.values()) warpCountIds.add(wc);
  let yarnCodeById = new Map<number, string>();
  if (warpCountIds.size > 0) {
    const { data } = await supabase.from('yarn_count').select('id, code').in('id', Array.from(warpCountIds));
    yarnCodeById = new Map(
      ((data ?? []) as Array<{ id: number; code: string | null }>)
        .filter((y) => y.code != null)
        .map((y) => [y.id, y.code as string]),
    );
  }

  const today = todayISO();

  return rows.map((r): MountHistoryRow => {
    const cm = r.costing_id != null ? costingById.get(r.costing_id) : undefined;
    const fq = r.costing_id != null ? fqByCostingId.get(r.costing_id) : undefined;
    const qualityName = fq
      ? (fq.is_merged && fq.merged_name ? fq.merged_name : fq.name ?? cm?.quality_name ?? null)
      : cm?.quality_name ?? null;

    const sizingJobId = r.pavu?.sizing_job_id;
    const sizingWc = sizingJobId != null ? warpCountIdBySizingJob.get(sizingJobId) : undefined;
    const jwbWc = warpCountIdByPavu.get(r.pavu_id);
    const warpCountId = sizingWc ?? jwbWc;
    const yarnCount = warpCountId != null ? yarnCodeById.get(warpCountId) ?? null : null;

    const mountDate = r.start_date;
    const unmountDate = r.end_date;
    const daysMounted =
      mountDate != null
        ? Math.max(
            0,
            Math.round(
              (new Date(unmountDate ?? today).getTime() - new Date(mountDate).getTime()) / 86_400_000,
            ),
          )
        : null;

    return {
      assign_id: r.id,
      pavu_id: r.pavu_id,
      pavu_code: r.pavu?.pavu_code ?? '—',
      beam_no: r.pavu?.beam_no ?? '—',
      ends: r.pavu?.ends ?? 0,
      yarn_count: yarnCount,
      quality_code: cm?.quality_code ?? null,
      quality_name: qualityName,
      production_mode: r.pavu?.production_mode ?? null,
      loom_id: r.loom_id,
      loom_code: r.loom?.loom_code ?? null,
      shed_no: r.loom?.shed_no ?? null,
      mount_date: mountDate,
      unmount_date: unmountDate,
      days_mounted: daysMounted,
      metres_produced: Number(r.metres_produced ?? 0),
      actual_metres: Number(r.actual_metres ?? 0),
      status: r.status,
      notes: r.notes,
    };
  });
}
```

- [ ] **Step 3: Append a temporary minimal default export so the file is a valid Next.js page**

```tsx
export default async function PavuMountHistoryReport() {
  return <div>Loading…</div>;
}
```

- [ ] **Step 4: Type-check**

Run: `cd C:\Users\Admin\ppk-work\app; npx tsc --noEmit`
Expected: exits with code 0, no errors. If `loadMountHistory` is reported as unused, that is expected at this point (it isn't called by the placeholder export yet) — this codebase's `tsconfig` does not fail the build on unused-function warnings, only on real type errors, but if it does report an unused-var error, add a temporary `void loadMountHistory;` line beneath the function and remove it in Task 2.

- [ ] **Step 5: Commit**

```bash
cd C:\Users\Admin\ppk-work\app
git add app/app/reports/pavu-mount-history/page.tsx
git commit -m "Add Pavu Mount History: types + data loader"
```

---

### Task 2: Report page — component logic (params, loads, filters, summary, export columns)

**Files:**
- Modify: `app/app/app/reports/pavu-mount-history/page.tsx`

- [ ] **Step 1: Replace the temporary default export from Task 1 with the real page component logic**

```tsx
/* ─────────────── page ─────────────── */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    loom_id?: string;
    shed?: string;
    mode?: string;
    quality_code?: string;
    ends?: string;
  }>;
}

export default async function PavuMountHistoryReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? startOfMonthISO();
  const to = sp.to ?? todayISO();
  const loomIdParam = sp.loom_id ?? '';
  const loomIdNum = loomIdParam && /^\d+$/.test(loomIdParam) ? Number(loomIdParam) : null;
  const shedParam = sp.shed ?? '';
  const modeFilter = sp.mode ?? '';
  const qualityCodeFilter = sp.quality_code ?? '';
  const endsParam = sp.ends ?? '';
  const endsNum = endsParam && /^\d+$/.test(endsParam) ? Number(endsParam) : null;

  const supabase = await createClient();

  const [allRows, loomRes] = await Promise.all([
    loadMountHistory(supabase, from, to).catch((): MountHistoryRow[] => []),
    supabase.from('loom').select('id, loom_code, shed_no').order('loom_code', { ascending: true }),
  ]);

  const looms = (loomRes.data as unknown as LoomOpt[]) ?? [];
  const loadError = loomRes.error?.message ?? null;

  // Filter option lists — derived from the date-filtered rows, mirroring
  // Beam Stock Report (options computed from the loaded set, not the
  // post-filter set, so picking one facet doesn't hide the others).
  const endsOptions = Array.from(new Set(allRows.map((r) => r.ends))).sort((a, b) => a - b);
  const shedOptions = Array.from(
    new Set(allRows.map((r) => r.shed_no).filter((v): v is number => v != null)),
  ).sort((a, b) => a - b);
  const modeOptions = Array.from(
    new Set(allRows.map((r) => r.production_mode).filter((v): v is string => !!v)),
  ).sort();
  const qualityOptions = Array.from(
    new Map(
      allRows
        .filter((r) => r.quality_code != null)
        .map((r) => [r.quality_code as string, r.quality_name ?? r.quality_code!]),
    ).entries(),
  ).sort((a, b) => a[0].localeCompare(b[0]));

  const rows = allRows.filter((r) => {
    if (loomIdNum != null && r.loom_id !== loomIdNum) return false;
    if (shedParam && String(r.shed_no ?? '') !== shedParam) return false;
    if (modeFilter && r.production_mode !== modeFilter) return false;
    if (qualityCodeFilter && r.quality_code !== qualityCodeFilter) return false;
    if (endsNum != null && r.ends !== endsNum) return false;
    return true;
  });

  // Summary rolled up by quality — mirrors Beam Stock Report's "Summary by
  // ends & yarn count" table.
  const summaryMap = new Map<string, { quality_code: string; quality_name: string | null; count: number; metres: number }>();
  for (const r of rows) {
    const key = r.quality_code ?? '—';
    const cur = summaryMap.get(key) ?? { quality_code: key, quality_name: r.quality_name, count: 0, metres: 0 };
    cur.count += 1;
    cur.metres += r.metres_produced;
    summaryMap.set(key, cur);
  }
  const summary = Array.from(summaryMap.values()).sort((a, b) => a.quality_code.localeCompare(b.quality_code));

  const totalMetres = rows.reduce((s, r) => s + r.metres_produced, 0);
  const stillMounted = rows.filter((r) => r.status === 'mounted' || r.status === 'running').length;

  const exportColumns: ExcelColumn[] = [
    { key: 'pavu_code', label: 'Pavu Code', type: 'text', width: 14 },
    { key: 'beam_no', label: 'Beam No', type: 'text', width: 12 },
    { key: 'ends', label: 'Ends', type: 'number', width: 8 },
    { key: 'yarn_count', label: 'Yarn Count', type: 'text', width: 12 },
    { key: 'quality_code', label: 'Quality Code', type: 'text', width: 14 },
    { key: 'quality_name', label: 'Quality Name', type: 'text', width: 24 },
    { key: 'mode_label', label: 'Mode', type: 'text', width: 12 },
    { key: 'loom_code', label: 'Loom', type: 'text', width: 10 },
    { key: 'shed_no', label: 'Shed', type: 'number', width: 8 },
    { key: 'mount_date', label: 'Mount Date', type: 'date', width: 13 },
    { key: 'unmount_date', label: 'Unmount Date', type: 'date', width: 13 },
    { key: 'days_mounted', label: 'Days Mounted', type: 'number', width: 12 },
    { key: 'metres_produced', label: 'Metres Produced', type: 'metre', width: 14, total: true },
    { key: 'actual_metres', label: 'Actual Metres', type: 'metre', width: 14, total: true },
    { key: 'status', label: 'Status', type: 'text', width: 12 },
  ];
  const exportRows = rows.map((r) => ({
    pavu_code: r.pavu_code,
    beam_no: r.beam_no,
    ends: r.ends,
    yarn_count: r.yarn_count ?? '',
    quality_code: r.quality_code ?? '',
    quality_name: r.quality_name ?? '',
    mode_label: r.production_mode ? MODE_LABEL[r.production_mode] ?? r.production_mode : '',
    loom_code: r.loom_code ?? '',
    shed_no: r.shed_no ?? '',
    mount_date: r.mount_date ?? '',
    unmount_date: r.unmount_date ?? '',
    days_mounted: r.days_mounted ?? '',
    metres_produced: r.metres_produced,
    actual_metres: r.actual_metres,
    status: r.status,
  }));

  return <div>Loading…</div>; // JSX body replaced in Task 3
}
```

- [ ] **Step 2: Type-check**

Run: `cd C:\Users\Admin\ppk-work\app; npx tsc --noEmit`
Expected: exits with code 0, no errors.

- [ ] **Step 3: Verify the loader's quality resolution against known data**

This project's warp-beam quality data has a known split used to catch quality-mismatch bugs (the same split used to verify the Assign-to-Loom modal fix this session): `jobwork_warp_beam` rows with `total_ends=2190` split into `fabric_quality_id=8` ("WHITE DHOTIES 2190", 19 rows) and `fabric_quality_id=5` ("BLACK DHOTIES 2190", 15 rows). Confirm the report's costing-based resolution produces a comparably split, non-collapsed set of quality codes for `pavu_assign` rows on 2190-end beams:

Run this SQL against the Supabase project (`cqyfbiecramujnzhgieg`):

```sql
select cm.quality_code, cm.quality_name, count(*) as mount_events
from pavu_assign pa
join pavu p on p.id = pa.pavu_id
join costing_master cm on cm.id = pa.costing_id
where p.ends = 2190
group by cm.quality_code, cm.quality_name
order by cm.quality_code;
```

Expected: more than one distinct `quality_code` in the result (i.e. mount events on 2190-end beams are NOT all collapsed into a single quality) — confirming the report's per-row `costing_id` resolution keeps white/black (or whichever qualities share 2190 ends) distinct, the same property the Assign-modal fix restored.

- [ ] **Step 4: Commit**

```bash
cd C:\Users\Admin\ppk-work\app
git add app/app/reports/pavu-mount-history/page.tsx
git commit -m "Add Pavu Mount History: page component logic"
```

---

### Task 3: Report page — JSX (filters, KPIs, summary, cards, table)

**Files:**
- Modify: `app/app/app/reports/pavu-mount-history/page.tsx`

- [ ] **Step 1: Replace the `return <div>Loading…</div>;` placeholder from Task 2 with the full JSX**

```tsx
  return (
    <div>
      <PageHeader
        title="Pavu Mount History"
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Pavu Mount History' }]}
        subtitle={`Every beam mounted between ${from} and ${to} — which loom it went on, what came off it, and how many metres it produced.`}
        actions={
          <ExcelExportButton
            filename="pavu-mount-history"
            sheetName="Mount History"
            title={`Pavu Mount History · ${from} to ${to}`}
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* ─────────────── Filter strip ─────────────── */}
      <form className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm" action="">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Loom</span>
          <select name="loom_id" defaultValue={loomIdParam} className="input min-w-[140px]">
            <option value="">All looms</option>
            {looms.map((l) => (
              <option key={l.id} value={l.id}>{l.loom_code}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Shed</span>
          <select name="shed" defaultValue={shedParam} className="input min-w-[110px]">
            <option value="">All sheds</option>
            {shedOptions.map((s) => (
              <option key={s} value={s}>Shed {s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Mode</span>
          <select name="mode" defaultValue={modeFilter} className="input min-w-[130px]">
            <option value="">All modes</option>
            {modeOptions.map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m] ?? m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Quality</span>
          <select name="quality_code" defaultValue={qualityCodeFilter} className="input min-w-[180px]">
            <option value="">All qualities</option>
            {qualityOptions.map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Ends</span>
          <select name="ends" defaultValue={endsParam} className="input min-w-[100px]">
            <option value="">All</option>
            {endsOptions.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary">Apply</button>
        <a href="/app/reports/pavu-mount-history" className="text-xs text-ink-mute self-center hover:text-ink underline">
          Reset
        </a>
      </form>

      {loadError && (
        <div className="card p-4 text-sm text-err mb-4">Could not load loom list: {loadError}</div>
      )}

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Kpi label="Mount events" value={String(rows.length)} icon={History} />
        <Kpi label="Still mounted" value={String(stillMounted)} icon={Gauge} />
        <Kpi label="Metres produced" value={formatMetres(totalMetres, 0)} icon={Layers} />
      </div>

      {/* ─────────────── Summary by quality ─────────────── */}
      {summary.length > 0 && (
        <div className="card p-4 mb-4 overflow-x-auto">
          <div className="text-xs uppercase tracking-wide text-ink-mute mb-2">Summary by quality</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-mute border-b border-line/60">
                <th className="py-1.5 pr-3">Quality</th>
                <th className="py-1.5 pr-3 text-right">Mounts</th>
                <th className="py-1.5 pr-3 text-right">Metres produced</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.quality_code} className="border-b border-line/30 last:border-0">
                  <td className="py-1.5 pr-3">
                    {s.quality_code}
                    {s.quality_name && <span className="text-ink-mute"> — {s.quality_name}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right num">{s.count}</td>
                  <td className="py-1.5 pr-3 text-right num">{formatMetres(s.metres, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─────────────── Detail ─────────────── */}
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No mount events in this window. Try widening the date range or clearing a filter.
        </div>
      ) : (
        <>
          <CardFilter placeholder="Search mount history…">
            {rows.map((r) => (
              <div key={r.assign_id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words">
                      {r.pavu_code} <span className="text-ink-mute">/ {r.beam_no}</span>
                    </div>
                    <div className="text-[10px] text-ink-mute">
                      {r.ends} ends · {r.yarn_count ?? '—'}
                      {r.quality_code ? ` · ${r.quality_code}` : ''}
                    </div>
                  </div>
                  <span className={`pill ${ASSIGN_STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'} text-[11px] uppercase tracking-wide shrink-0`}>
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-2 space-y-1">
                  <div>Loom: <span className="text-ink">{r.loom_code ?? '—'}{r.shed_no != null ? ` (Shed ${r.shed_no})` : ''}</span></div>
                  <div>Mode: {r.production_mode ? MODE_LABEL[r.production_mode] ?? r.production_mode : '—'}</div>
                  <div>Mounted: <span className="num">{fmtDate(r.mount_date)}</span> → Unmounted: <span className="num">{fmtDate(r.unmount_date)}</span></div>
                  <div>Days mounted: <span className="num">{r.days_mounted ?? '—'}</span></div>
                  <div>Metres: <span className="num">{formatMetres(r.metres_produced, 1)}</span> produced / <span className="num">{formatMetres(r.actual_metres, 1)}</span> actual</div>
                </div>
              </div>
            ))}
          </CardFilter>

          <div className="card p-0 overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-3 py-3">Beam</th>
                  <th className="text-left px-3 py-3">Ends</th>
                  <th className="text-left px-3 py-3">Yarn</th>
                  <th className="text-left px-3 py-3">Quality</th>
                  <th className="text-left px-3 py-3">Mode</th>
                  <th className="text-left px-3 py-3">Loom / Shed</th>
                  <th className="text-left px-3 py-3">Mounted</th>
                  <th className="text-left px-3 py-3">Unmounted</th>
                  <th className="text-right px-3 py-3">Days</th>
                  <th className="text-right px-3 py-3">Metres</th>
                  <th className="text-left px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assign_id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.pavu_code} <span className="text-ink-mute">/ {r.beam_no}</span></td>
                    <td className="px-3 py-2 num text-xs">{r.ends}</td>
                    <td className="px-3 py-2 text-xs">{r.yarn_count ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.quality_code ?? '—'}
                      {r.quality_name && <div className="text-[10px] text-ink-mute">{r.quality_name}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.production_mode ? MODE_LABEL[r.production_mode] ?? r.production_mode : '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.loom_code ?? '—'}{r.shed_no != null ? ` (S${r.shed_no})` : ''}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.mount_date)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.unmount_date)}</td>
                    <td className="px-3 py-2 text-right num text-xs">{r.days_mounted ?? '—'}</td>
                    <td className="px-3 py-2 text-right num text-xs">{formatMetres(r.metres_produced, 1)}</td>
                    <td className="px-3 py-2">
                      <span className={`pill ${ASSIGN_STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'} text-[11px] uppercase tracking-wide`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────── presentational helpers ─────────────── */

interface KpiProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

function Kpi({ label, value, icon: Icon }: KpiProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
        <Icon className="w-4 h-4 text-ink-mute" />
      </div>
      <div className="num text-xl font-bold">{value}</div>
    </div>
  );
}
```

Note: this closes the `PavuMountHistoryReport` function body (replacing its old placeholder return) and adds the `Kpi` helper after it, exactly mirroring `fabric-movements/page.tsx`'s structure (page component, then presentational helpers, in one file).

- [ ] **Step 2: Type-check**

Run: `cd C:\Users\Admin\ppk-work\app; npx tsc --noEmit`
Expected: exits with code 0, no errors.

- [ ] **Step 3: Start the dev server and visually sanity-check the page**

Run: `cd C:\Users\Admin\ppk-work\app; npm run dev`
Open `http://localhost:3000/app/reports/pavu-mount-history` in a browser.
Expected: page loads without a Next.js error overlay, filter strip renders, KPI strip shows non-crashing numbers, and (given 70 rows in `pavu_assign` and a default date range of "1st of this month → today") either a populated table or the empty-state message — both are valid depending on how many mounts happened this month. Stop the dev server afterward (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
cd C:\Users\Admin\ppk-work\app
git add app/app/reports/pavu-mount-history/page.tsx
git commit -m "Add Pavu Mount History: filters, KPIs, summary, table UI"
```

---

### Task 4: Register the report on the Reports index

**Files:**
- Modify: `app/app/app/reports/page.tsx`

- [ ] **Step 1: Add the new entry to the `REPORTS` array, immediately after the `fabric-movements` entry**

In `app/app/app/reports/page.tsx`, find this existing entry (around line 148):

```tsx
  {
    href: '/app/reports/fabric-movements',
    title: 'Fabric Movements',
    description:
      'Per-event log of every fabric receipt and invoice line — what came in from production, what shipped out, and which invoices are still unpaid.',
    ready: true,
  },
```

Insert immediately after it:

```tsx
  {
    href: '/app/reports/pavu-mount-history',
    title: 'Pavu Mount History',
    description:
      'History of every beam mount event — which pavu went on which loom, when it mounted and unmounted, and how many metres it produced. Filter by date range, loom, shed, mode, quality and ends.',
    ready: true,
  },
```

- [ ] **Step 2: Type-check**

Run: `cd C:\Users\Admin\ppk-work\app; npx tsc --noEmit`
Expected: exits with code 0, no errors.

- [ ] **Step 3: Commit**

```bash
cd C:\Users\Admin\ppk-work\app
git add app/app/reports/page.tsx
git commit -m "Add Pavu Mount History card to Reports index"
```

---

### Task 5: Final verification and deploy

**Files:** none (verification only)

- [ ] **Step 1: Full project type-check**

Run: `cd C:\Users\Admin\ppk-work\app; npx tsc --noEmit`
Expected: exits with code 0, no errors, across the whole project (not just the new file).

- [ ] **Step 2: Confirm the default date window returns the expected row count**

Run this SQL against the Supabase project (`cqyfbiecramujnzhgieg`), substituting today's actual date for `CURRENT_DATE`:

```sql
select count(*) as mounts_this_month
from pavu_assign
where start_date >= date_trunc('month', current_date)::date
  and start_date <= current_date;
```

Expected: a non-negative integer. Cross-check this number against what the page's "Mount events" KPI shows when loaded with no filters (default date range) — they must match exactly.

- [ ] **Step 3: Confirm the full-history total matches `pavu_assign`'s known row count**

Run this SQL:

```sql
select status, count(*) from pavu_assign group by status order by status;
```

Expected (per the design spec, may have grown since 2026-07-18): roughly `mounted` ≈ 52, `completed` ≈ 10, `removed` ≈ 8. Then load the report with `?from=2000-01-01&to=` (today's date) — a window wide enough to include every row — and confirm the "Mount events" KPI equals the sum of all three counts from this query.

- [ ] **Step 4: Push and confirm the Vercel deployment**

```bash
cd C:\Users\Admin\ppk-work\app
git push
```

Then poll the Vercel deployment for the pushed commit (project `prj_mKFlvYjJEwZzwKsAWqzkmFrmnLy9`, team `team_ehcRznO1Qj7Lpmw52xcVmhRn`) via `list_deployments` → `get_deployment` until `readyState` is `READY` (or `ERROR`, in which case pull the build logs and fix before proceeding).

- [ ] **Step 5: Smoke-test the live report**

Open `https://<production-domain>/app/reports/pavu-mount-history` (or the Vercel preview URL for this deployment) and confirm: the page loads, the Reports index (`/app/reports`) now shows the "Pavu Mount History" card, and the Excel export button downloads a file.

---

## Self-review notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-18-pavu-mount-history-design.md` is covered — data source (`pavu_assign`, direct joins, no new table), date-range filter semantics (mount-date `start_date` in `[from, to]`, still-mounted beams included), all eleven columns, all five filters (loom, shed, mode, quality, ends, plus the required date range), the quality-summary rollup, the `ExcelExportButton` export, and the Reports-index navigation entry.
- **Placeholder scan:** no "TBD"/"TODO" — the two intermediate placeholder `return`s (Task 1 Step 3, Task 2 Step 3) are real, compilable, temporary code that gets replaced in the very next task, not unfinished work left behind.
- **Type consistency:** `MountHistoryRow` is defined once in Task 1 and used identically (same field names) in Task 2's filtering/summary/export logic and Task 3's JSX — verified during authoring that every field referenced in JSX (`r.pavu_code`, `r.ends`, `r.yarn_count`, `r.quality_code`, `r.quality_name`, `r.production_mode`, `r.loom_code`, `r.shed_no`, `r.mount_date`, `r.unmount_date`, `r.days_mounted`, `r.metres_produced`, `r.actual_metres`, `r.status`, `r.assign_id`) exists on the interface from Task 1.
- **No new dependencies:** `History` and `Gauge` icons were confirmed present in the installed `lucide-react` package (`node_modules/lucide-react/dist/lucide-react.d.ts`) before being used; `Layers` was already proven in use by `fabric-movements/page.tsx`.
