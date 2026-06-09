# Production vs Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new period-scoped Production vs Delivery report at `/app/reports/production-vs-delivery` that surfaces per-quality variance between metres produced (shift logs for in-house; fabric receipts for jobwork / outsource) and metres delivered (DC items), with a flat row-per-(quality,mode) screen and a quality-grouped Excel export.

**Architecture:** One new SQL function `fn_production_vs_delivery(p_from, p_to)` performs all joins and date filtering server-side. The page is a Next.js 15 Server Component that calls the function via `supabase.rpc`, renders the KPIs + filter pills + sortable table, and feeds the existing `ExcelExportButton` component a pre-formatted quality-grouped row set for the export sheet.

**Tech Stack:** Postgres (Supabase), Next.js 15 App Router, TypeScript strict, Tailwind. Migration deployed via `mcp__fc96fade-…__apply_migration`. Page changes deployed via `git push origin main` → Vercel.

**Spec:** `docs/superpowers/specs/2026-06-09-production-vs-delivery-design.md`

---

## File Structure

| Action | Path | Responsibility |
|---|---|---|
| Create | `app/db/migrations/149_production_vs_delivery_fn.sql` | Defines `fn_production_vs_delivery(p_from, p_to)`. Returns one row per (fabric_quality_id, production_mode) plus a fallback row for unattributed shift-log metres. |
| Create | `app/app/app/reports/production-vs-delivery/page.tsx` | Server Component. Reads period from `?from=&to=&preset=` and mode filter from `?mode=`. Calls the RPC. Renders KPIs + table + Excel export. |
| Modify | `app/app/app/reports/page.tsx` | Adds a link card for the new report in the Reports index. |

No other files touched.

---

## Task 1: Write the SQL function (migration 149)

**Files:**
- Create: `app/db/migrations/149_production_vs_delivery_fn.sql`

- [ ] **Step 1.1: Create the migration file with the function definition**

Write the file with these contents:

```sql
-- 149_production_vs_delivery_fn.sql
-- fn_production_vs_delivery(p_from, p_to) → one row per
-- (fabric_quality_id, production_mode) inside the window:
--
--   inhouse     produced = shift_log.metres_woven for the loom on a day
--               that lies inside the loom's active production_batch
--               window; quality = batch's costing_master.quality_code
--   jobwork     produced = fabric_receipt_item.received_metres on
--               receipts whose DC has production_mode='jobwork'
--   outsource   same as jobwork but production_mode='outsource'
--
-- Delivered (every mode) = delivery_challan_item.metres on DCs whose
-- production_mode matches and status IN ('confirmed','invoiced').
--
-- Shift-log rows with no overlapping production_batch land on a
-- 'unattributed' row (NULL quality) so they're visible without
-- polluting quality totals.

CREATE OR REPLACE FUNCTION public.fn_production_vs_delivery(p_from date, p_to date)
RETURNS TABLE (
  fabric_quality_id bigint,
  quality_code      text,
  quality_name      text,
  production_mode   text,
  produced_m        numeric,
  delivered_m       numeric,
  variance_m        numeric,
  variance_pct      numeric,
  last_activity     date
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
WITH
  -- ── In-house production via shift_log → production_batch → quality
  ih_attributed AS (
    SELECT
      cm.id                AS fabric_quality_id,
      cm.quality_code,
      cm.quality_name,
      SUM(psl.metres_woven)::numeric  AS produced_m,
      MAX(psl.log_date)               AS last_event
    FROM public.production_shift_log psl
    JOIN public.production_batch pb
      ON pb.loom_id = psl.loom_id
     AND psl.log_date BETWEEN pb.start_date AND pb.end_date
    JOIN public.costing_master cm ON cm.id = pb.costing_id
    LEFT JOIN public.fabric_quality fq ON fq.code = cm.quality_code
    WHERE psl.log_date BETWEEN p_from AND p_to
    GROUP BY cm.id, cm.quality_code, cm.quality_name
  ),
  -- ── Shift-log metres with NO matching batch (unattributed)
  ih_unattributed AS (
    SELECT
      NULL::bigint AS fabric_quality_id,
      NULL::text   AS quality_code,
      'Unattributed (no active batch)'::text AS quality_name,
      SUM(psl.metres_woven)::numeric AS produced_m,
      MAX(psl.log_date)              AS last_event
    FROM public.production_shift_log psl
    WHERE psl.log_date BETWEEN p_from AND p_to
      AND NOT EXISTS (
        SELECT 1 FROM public.production_batch pb
        WHERE pb.loom_id = psl.loom_id
          AND psl.log_date BETWEEN pb.start_date AND pb.end_date
      )
    HAVING SUM(psl.metres_woven) > 0
  ),
  -- ── Jobwork / Outsource production via fabric receipts
  jw_os_prod AS (
    SELECT
      fri.fabric_quality_id,
      fq.code AS quality_code,
      fq.name AS quality_name,
      dc.production_mode,
      SUM(fri.received_metres)::numeric AS produced_m,
      MAX(fr.receipt_date)              AS last_event
    FROM public.fabric_receipt_item fri
    JOIN public.fabric_receipt fr ON fr.id = fri.receipt_id
    JOIN public.delivery_challan dc ON dc.id = fr.dc_id
    LEFT JOIN public.fabric_quality fq ON fq.id = fri.fabric_quality_id
    WHERE dc.production_mode IN ('jobwork','outsource')
      AND fr.receipt_date BETWEEN p_from AND p_to
    GROUP BY fri.fabric_quality_id, fq.code, fq.name, dc.production_mode
  ),
  -- ── Delivered side (all three modes)
  delivered AS (
    SELECT
      dci.fabric_quality_id,
      dc.production_mode,
      SUM(dci.metres)::numeric AS delivered_m,
      MAX(dc.dc_date)          AS last_dc_date
    FROM public.delivery_challan_item dci
    JOIN public.delivery_challan dc ON dc.id = dci.dc_id
    WHERE dc.status IN ('confirmed','invoiced')
      AND dc.dc_date BETWEEN p_from AND p_to
    GROUP BY dci.fabric_quality_id, dc.production_mode
  ),
  -- ── Union all production sides under a common shape
  produced_all AS (
    SELECT fabric_quality_id, quality_code, quality_name,
           'inhouse'::text AS production_mode, produced_m, last_event
    FROM ih_attributed
    UNION ALL
    SELECT fabric_quality_id, quality_code, quality_name,
           'unattributed'::text, produced_m, last_event
    FROM ih_unattributed
    UNION ALL
    SELECT fabric_quality_id, quality_code, quality_name,
           production_mode, produced_m, last_event
    FROM jw_os_prod
  )
SELECT
  COALESCE(p.fabric_quality_id, d.fabric_quality_id)              AS fabric_quality_id,
  COALESCE(p.quality_code, fq.code)                               AS quality_code,
  COALESCE(p.quality_name, fq.name, 'Unknown quality')            AS quality_name,
  COALESCE(p.production_mode, d.production_mode)                  AS production_mode,
  COALESCE(p.produced_m, 0)::numeric(14,2)                        AS produced_m,
  COALESCE(d.delivered_m, 0)::numeric(14,2)                       AS delivered_m,
  (COALESCE(p.produced_m, 0) - COALESCE(d.delivered_m, 0))::numeric(14,2)
                                                                  AS variance_m,
  CASE
    WHEN COALESCE(p.produced_m, 0) > 0
      THEN ((COALESCE(p.produced_m, 0) - COALESCE(d.delivered_m, 0))
            / p.produced_m * 100)::numeric(8,2)
    ELSE NULL
  END                                                             AS variance_pct,
  GREATEST(p.last_event, d.last_dc_date)                          AS last_activity
FROM produced_all p
FULL OUTER JOIN delivered d
  ON d.fabric_quality_id = p.fabric_quality_id
 AND d.production_mode   = p.production_mode
LEFT JOIN public.fabric_quality fq ON fq.id = d.fabric_quality_id
WHERE COALESCE(p.produced_m, 0) + COALESCE(d.delivered_m, 0) > 0;

COMMENT ON FUNCTION public.fn_production_vs_delivery(date, date) IS
  'Per-(quality, mode) production vs delivery for a date window. inhouse rows come from shift logs joined to active production_batch; jobwork/outsource rows from fabric receipts on DCs of that mode. Delivered = DC items with status confirmed/invoiced. Unattributed shift-log metres surface on a NULL-quality row.';
```

- [ ] **Step 1.2: Apply the migration via Supabase MCP**

Use the `mcp__fc96fade-ba03-4c93-9f74-3392a8739d16__apply_migration` tool:

```
project_id: cqyfbiecramujnzhgieg
name: 149_production_vs_delivery_fn
query: <the SQL body from Step 1.1, no markdown fences>
```

Expected: `{"success": true}`.

- [ ] **Step 1.3: Verify the function returns rows for the current FY**

Use the Supabase MCP `execute_sql` tool:

```sql
SELECT production_mode, COUNT(*) AS rows,
       COALESCE(SUM(produced_m),  0)::numeric(14,2) AS produced,
       COALESCE(SUM(delivered_m), 0)::numeric(14,2) AS delivered
FROM public.fn_production_vs_delivery('2026-04-01'::date, CURRENT_DATE)
GROUP BY production_mode
ORDER BY production_mode;
```

Expected: at most 4 rows (`inhouse`, `jobwork`, `outsource`, `unattributed`). For PPK Tex's current data set, `jobwork` should appear with non-zero produced + delivered; other modes may be zero rows (no data yet) — that's fine.

- [ ] **Step 1.4: Verify the unattributed row surfaces when expected**

Use the Supabase MCP `execute_sql`:

```sql
SELECT *
FROM public.fn_production_vs_delivery('2026-04-01'::date, CURRENT_DATE)
WHERE production_mode = 'unattributed';
```

If you have any shift logs in the window whose loom had no active batch on that day, this returns one row with `fabric_quality_id` NULL. If you have no shift logs at all (the current PPK Tex state), this returns zero rows.

- [ ] **Step 1.5: Commit the migration file**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/db/migrations/149_production_vs_delivery_fn.sql'
git commit -m "feat(reports): migration 149 — fn_production_vs_delivery

One row per (fabric_quality_id, production_mode) for the window:
- inhouse: shift_log metres resolved to quality via the loom's
  active production_batch
- jobwork / outsource: fabric_receipt_item metres on DCs of that mode
- delivered: DC items with status confirmed/invoiced
- unattributed: shift-log metres with no matching batch (NULL
  quality, visible row at the bottom)"
```

Do NOT push yet — the page changes come in later tasks.

---

## Task 2: Page skeleton (route, period picker, RPC call)

**Files:**
- Create: `app/app/app/reports/production-vs-delivery/page.tsx`

- [ ] **Step 2.1: Write the initial page file**

```tsx
/**
 * /app/reports/production-vs-delivery — Production vs Delivery.
 *
 * Per-quality variance between metres produced and metres delivered
 * in a chosen window, split by production mode (in-house, jobwork,
 * outsource). Source: fn_production_vs_delivery(p_from, p_to).
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';

export const metadata = { title: 'Production vs Delivery' };
export const dynamic = 'force-dynamic';

interface PvDRow {
  fabric_quality_id: number | null;
  quality_code: string | null;
  quality_name: string | null;
  production_mode: 'inhouse' | 'jobwork' | 'outsource' | 'unattributed';
  produced_m: number | string;
  delivered_m: number | string;
  variance_m: number | string;
  variance_pct: number | string | null;
  last_activity: string | null;
}

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    preset?: string;
    mode?: string;
  }>;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:   isoDate(now),
  };
}

function presetRange(preset: string | undefined): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === 'this_month') return thisMonthRange();
  if (preset === 'last_month') {
    const start = new Date(y, m - 1, 1);
    const end   = new Date(y, m, 0);
    return { from: isoDate(start), to: isoDate(end) };
  }
  if (preset === 'this_quarter') {
    const q = Math.floor(m / 3);
    const start = new Date(y, q * 3, 1);
    return { from: isoDate(start), to: isoDate(now) };
  }
  if (preset === 'fy_to_date') {
    const fyStart = m >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
    return { from: isoDate(fyStart), to: isoDate(now) };
  }
  if (preset === 'last_30d') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { from: isoDate(start), to: isoDate(now) };
  }
  return null;
}

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmtMetres(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default async function ProductionVsDeliveryPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const preset = sp.preset ? presetRange(sp.preset) : null;
  const fromInput = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const toInput   = sp.to   && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)   ? sp.to   : null;
  const def = thisMonthRange();
  const from = fromInput ?? preset?.from ?? def.from;
  const to   = toInput   ?? preset?.to   ?? def.to;

  const modeFilter: 'all' | 'inhouse' | 'jobwork' | 'outsource' =
    sp.mode === 'inhouse'   ? 'inhouse'   :
    sp.mode === 'jobwork'   ? 'jobwork'   :
    sp.mode === 'outsource' ? 'outsource' : 'all';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb.rpc('fn_production_vs_delivery', { p_from: from, p_to: to });
  const allRows: PvDRow[] = Array.isArray(data) ? (data as PvDRow[]) : [];

  return (
    <div>
      <PageHeader
        title="Production vs Delivery"
        subtitle="Per-quality comparison of metres produced (shift logs / fabric receipts) vs metres delivered on DCs. Variance flags where production is drifting from dispatch."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Production vs Delivery' },
        ]}
      />

      {/* Period picker — same shape as the P&L report */}
      <form action="/app/reports/production-vs-delivery" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="mode" value={modeFilter === 'all' ? '' : modeFilter} />
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">From</span>
          <input name="from" type="date" defaultValue={from} className="input py-1 text-xs" />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">To</span>
          <input name="to" type="date" defaultValue={to} className="input py-1 text-xs" />
        </label>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        <div className="flex items-center gap-1 ml-auto text-[11px]">
          <span className="text-ink-mute">Quick:</span>
          <Link href={`/app/reports/production-vs-delivery?preset=this_month&mode=${modeFilter}`}   className="text-indigo-700 underline">This month</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=last_month&mode=${modeFilter}`}   className="text-indigo-700 underline">Last month</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=this_quarter&mode=${modeFilter}`} className="text-indigo-700 underline">Quarter</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=fy_to_date&mode=${modeFilter}`}   className="text-indigo-700 underline">FY-to-date</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/production-vs-delivery?preset=last_30d&mode=${modeFilter}`}     className="text-indigo-700 underline">Last 30d</Link>
        </div>
      </form>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load report: {error.message}</div>
      )}

      <p className="text-[11px] text-ink-mute mt-4">
        Period: <strong>{from}</strong> to <strong>{to}</strong>. {allRows.length} row{allRows.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
```

- [ ] **Step 2.2: Run a local smoke check by opening the route**

In the running dev server (`pnpm dev` inside `app/`), navigate to `/app/reports/production-vs-delivery`. The page should render the title, breadcrumb, date picker with `this_month` defaults, and a footer "Period: 2026-MM-01 to YYYY-MM-DD. N rows." with no error card.

- [ ] **Step 2.3: Commit the page skeleton**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/app/app/reports/production-vs-delivery/page.tsx'
git commit -m "feat(reports): Production vs Delivery page skeleton

Server Component, ?from / ?to / ?preset / ?mode URL state, calls
fn_production_vs_delivery via supabase.rpc. KPIs and table land in
the next commit."
```

Don't push yet.

---

## Task 3: KPI strip + filter pills + sortable table

**Files:**
- Modify: `app/app/app/reports/production-vs-delivery/page.tsx`

- [ ] **Step 3.1: Add filter + sort logic in the page**

Right after the `const allRows: PvDRow[] = …` line, add:

```typescript
// Apply the URL mode filter — 'all' keeps everything; otherwise drop
// rows that don't match. 'unattributed' rows ALWAYS show (they're a
// data-quality flag) unless the user explicitly filtered to a mode.
const filteredRows: PvDRow[] = allRows.filter((r) => {
  if (modeFilter === 'all') return true;
  if (r.production_mode === 'unattributed') return false;
  return r.production_mode === modeFilter;
});

// Default sort: |variance_m| desc so the biggest swings surface first.
// Stable secondary sort by quality_code.
const sortedRows: PvDRow[] = [...filteredRows].sort((a, b) => {
  const av = Math.abs(num(a.variance_m));
  const bv = Math.abs(num(b.variance_m));
  if (av !== bv) return bv - av;
  const ac = a.quality_code ?? '';
  const bc = b.quality_code ?? '';
  return ac.localeCompare(bc);
});

// KPI numbers run over the (already-mode-filtered) rows so the strip
// matches what's on screen.
const totalProduced  = sortedRows.reduce((s, r) => s + num(r.produced_m),  0);
const totalDelivered = sortedRows.reduce((s, r) => s + num(r.delivered_m), 0);
const netVariance    = totalProduced - totalDelivered;
const lineCount      = sortedRows.length;
```

- [ ] **Step 3.2: Add an icon-import line at the top of the file**

Add right after `import { PageHeader } from '@/app/components/page-header';`:

```typescript
import { Layers, TrendingUp, TrendingDown, Equal } from 'lucide-react';
```

- [ ] **Step 3.3: Render the mode-filter pills above the period picker**

Right after the `<PageHeader … />` element (and BEFORE the `<form …>` period picker), insert:

```tsx
{/* Mode filter pills. URL state via ?mode=. */}
<div className="mb-3 flex items-center gap-1">
  {(['all', 'inhouse', 'jobwork', 'outsource'] as const).map((m) => {
    const qs = new URLSearchParams();
    if (sp.from)   qs.set('from',   sp.from);
    if (sp.to)     qs.set('to',     sp.to);
    if (sp.preset) qs.set('preset', sp.preset);
    if (m !== 'all') qs.set('mode', m);
    const href = `/app/reports/production-vs-delivery${qs.toString() ? `?${qs.toString()}` : ''}`;
    const label = m === 'all' ? 'All' :
                  m === 'inhouse' ? 'In-house' :
                  m === 'jobwork' ? 'Job Work' : 'Outsource';
    const active = modeFilter === m;
    return (
      <Link
        key={m}
        href={href}
        className={
          'px-3 py-1.5 rounded-md text-xs font-semibold border border-line ' +
          (active ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
        }
      >
        {label}
      </Link>
    );
  })}
</div>
```

- [ ] **Step 3.4: Render the KPI strip right after the period-picker form**

Insert AFTER the period-picker `</form>` and BEFORE the `{error && …}` block:

```tsx
{/* KPI strip */}
<div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
  <div className="card p-3">
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-mute">
      <Layers className="w-3.5 h-3.5" /> Produced
    </div>
    <div className="num text-xl font-bold text-emerald-700">{fmtMetres(totalProduced)} m</div>
  </div>
  <div className="card p-3">
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-mute">
      <TrendingDown className="w-3.5 h-3.5" /> Delivered
    </div>
    <div className="num text-xl font-bold text-indigo-700">{fmtMetres(totalDelivered)} m</div>
  </div>
  <div className="card p-3">
    <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink-mute">
      {netVariance > 0
        ? <TrendingUp   className="w-3.5 h-3.5 text-emerald-700" />
        : netVariance < 0
          ? <TrendingDown className="w-3.5 h-3.5 text-rose-700" />
          : <Equal        className="w-3.5 h-3.5 text-ink-mute" />}
      Net Variance
    </div>
    <div className={'num text-xl font-bold ' + (netVariance > 0 ? 'text-emerald-700' : netVariance < 0 ? 'text-rose-700' : 'text-ink-mute')}>
      {netVariance >= 0 ? '+' : ''}{fmtMetres(netVariance)} m
    </div>
  </div>
  <div className="card p-3">
    <div className="text-[11px] uppercase tracking-wide text-ink-mute">Lines</div>
    <div className="num text-xl font-bold">{lineCount}</div>
  </div>
</div>
```

- [ ] **Step 3.5: Render the sortable table**

Insert AFTER the KPI strip and BEFORE the existing `{error && …}` block:

```tsx
{/* Per (quality, mode) table — default sort by |variance| desc. */}
{sortedRows.length === 0 ? (
  <div className="card p-6 text-sm text-ink-soft">
    No production or delivery in this period. Try a wider window or a different mode.
  </div>
) : (
  <div className="card overflow-x-auto">
    <table className="w-full text-sm">
      <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
        <tr>
          <th className="text-left  px-3 py-3">Quality</th>
          <th className="text-left  px-3 py-3">Mode</th>
          <th className="text-right px-3 py-3">Produced (m)</th>
          <th className="text-right px-3 py-3">Delivered (m)</th>
          <th className="text-right px-3 py-3">Variance (m)</th>
          <th className="text-right px-3 py-3">Var %</th>
          <th className="text-left  px-3 py-3">Last activity</th>
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((r) => {
          const v = num(r.variance_m);
          const variancePct = r.variance_pct == null ? null : Number(r.variance_pct);
          const modeLabel =
            r.production_mode === 'inhouse'      ? 'In-house' :
            r.production_mode === 'jobwork'      ? 'Job Work' :
            r.production_mode === 'outsource'    ? 'Outsource' :
            'Unattributed';
          const modeClass =
            r.production_mode === 'inhouse'      ? 'bg-emerald-50 text-emerald-700' :
            r.production_mode === 'jobwork'      ? 'bg-amber-50 text-amber-700' :
            r.production_mode === 'outsource'    ? 'bg-indigo-50 text-indigo-700' :
                                                    'bg-rose-50 text-rose-700';
          const varClass = v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-700' : 'text-ink-soft';
          const qualityCell = r.fabric_quality_id != null && r.quality_code
            ? (
              <Link
                href={`/app/warehouse/fabric/${r.fabric_quality_id}`}
                className="text-indigo-700 hover:underline font-semibold"
                title="Open per-quality stock ledger"
              >
                {r.quality_code}
              </Link>
            )
            : <span className="font-semibold text-ink-mute">{r.quality_name ?? '—'}</span>;
          return (
            <tr key={`${r.fabric_quality_id ?? 'na'}-${r.production_mode}`} className="border-t border-line/40 hover:bg-haze/60">
              <td className="px-3 py-2">
                {qualityCell}
                {r.quality_name && r.quality_code && (
                  <div className="text-[10px] text-ink-mute">{r.quality_name}</div>
                )}
              </td>
              <td className="px-3 py-2">
                <span className={'inline-block px-2 py-0.5 rounded text-[11px] ' + modeClass}>
                  {modeLabel}
                </span>
              </td>
              <td className="px-3 py-2 text-right num">{fmtMetres(num(r.produced_m))}</td>
              <td className="px-3 py-2 text-right num">{fmtMetres(num(r.delivered_m))}</td>
              <td className={'px-3 py-2 text-right num font-semibold ' + varClass}>
                {v >= 0 ? '+' : ''}{fmtMetres(v)}
              </td>
              <td className={'px-3 py-2 text-right num ' + varClass}>
                {variancePct == null ? '—' : `${variancePct >= 0 ? '+' : ''}${variancePct.toFixed(1)}%`}
              </td>
              <td className="px-3 py-2 text-xs text-ink-soft whitespace-nowrap">
                {r.last_activity ?? '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
)}
```

- [ ] **Step 3.6: Move the "Period: … N rows" footer paragraph below the table**

Find the existing footer `<p className="text-[11px] text-ink-mute mt-4">…</p>` (added in Task 2) and re-anchor it so it sits AFTER the table block, AFTER the `{error && …}` block. The same line stays as-is; just move it down.

- [ ] **Step 3.7: Smoke test in the browser**

With `pnpm dev` running, hit `/app/reports/production-vs-delivery`. Confirm:
- Mode pills render and toggling them updates the URL + the table.
- KPI strip shows Produced / Delivered / Net Variance / Lines numbers.
- Table sorted with the biggest absolute variance first.
- Quality cell is a link only when `fabric_quality_id` is set (the `unattributed` row shows just text).

- [ ] **Step 3.8: Commit the KPIs + table**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/app/app/reports/production-vs-delivery/page.tsx'
git commit -m "feat(reports): Production vs Delivery — KPI strip + table

Mode filter pills (All / In-house / Job Work / Outsource), KPI strip
(Produced / Delivered / Net Variance / Lines), and a per (quality,
mode) table sorted by |variance| desc. Quality cell links into the
per-quality stock ledger at /app/warehouse/fabric/[qualityId]."
```

---

## Task 4: Excel export (quality-grouped sections)

**Files:**
- Modify: `app/app/app/reports/production-vs-delivery/page.tsx`

- [ ] **Step 4.1: Import the Excel export pieces**

At the top of the file, add right after the `lucide-react` import:

```typescript
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
```

- [ ] **Step 4.2: Build the column spec + grouped row set**

Right BELOW the `const sortedRows = …` block (Task 3), add:

```typescript
// ── Excel export: quality-grouped rows ────────────────────────────
// One section per quality (header row, three mode rows, quality
// total, blank divider). A grand total row sits at the very bottom.
// `kind` is a hidden control column the column spec doesn't render
// but the bold / divider styling uses to decide row formatting.
const exportColumns: ExcelColumn[] = [
  { key: 'quality',     label: 'Quality',       type: 'text',   width: 28 },
  { key: 'mode',        label: 'Mode',          type: 'text',   width: 14 },
  { key: 'produced_m',  label: 'Produced (m)',  type: 'number', total: true },
  { key: 'delivered_m', label: 'Delivered (m)', type: 'number', total: true },
  { key: 'variance_m',  label: 'Variance (m)',  type: 'number', total: true },
  { key: 'variance_pct',label: 'Var %',         type: 'number' },
  { key: 'last_activity', label: 'Last activity', type: 'text', width: 14 },
];

// Build the grouped rows. Group by fabric_quality_id (NULL goes last).
const byQuality = new Map<string, PvDRow[]>();
for (const r of sortedRows) {
  const key = r.fabric_quality_id == null
    ? '__unattributed__'
    : String(r.fabric_quality_id);
  const bucket = byQuality.get(key) ?? [];
  bucket.push(r);
  byQuality.set(key, bucket);
}

interface ExportRow {
  quality: string;
  mode: string;
  produced_m: number | '';
  delivered_m: number | '';
  variance_m: number | '';
  variance_pct: number | '';
  last_activity: string;
}
const exportRows: ExportRow[] = [];
const qualityOrder = [...byQuality.keys()].sort((a, b) => {
  if (a === '__unattributed__') return 1;
  if (b === '__unattributed__') return -1;
  const bucketA = byQuality.get(a)!;
  const bucketB = byQuality.get(b)!;
  const ca = bucketA[0]?.quality_code ?? '';
  const cb = bucketB[0]?.quality_code ?? '';
  return ca.localeCompare(cb);
});
for (const key of qualityOrder) {
  const bucket = byQuality.get(key) ?? [];
  if (bucket.length === 0) continue;
  const first = bucket[0]!;
  const header = first.quality_code
    ? `${first.quality_code} — ${first.quality_name ?? ''}`
    : (first.quality_name ?? 'Unattributed');
  // Section header (blank quality cell on the data rows below)
  exportRows.push({
    quality: header, mode: '',
    produced_m: '', delivered_m: '', variance_m: '', variance_pct: '',
    last_activity: '',
  });
  let prodSum = 0, delivSum = 0, varSum = 0;
  for (const r of bucket) {
    const p = num(r.produced_m);
    const d = num(r.delivered_m);
    const v = num(r.variance_m);
    prodSum += p; delivSum += d; varSum += v;
    exportRows.push({
      quality: '',
      mode: r.production_mode === 'inhouse'   ? 'In-house'
          : r.production_mode === 'jobwork'   ? 'Job Work'
          : r.production_mode === 'outsource' ? 'Outsource'
          :                                     'Unattributed',
      produced_m:   p,
      delivered_m:  d,
      variance_m:   v,
      variance_pct: r.variance_pct == null ? '' : Number(r.variance_pct),
      last_activity: r.last_activity ?? '',
    });
  }
  // Quality total row
  exportRows.push({
    quality: 'Quality total', mode: '',
    produced_m: prodSum, delivered_m: delivSum, variance_m: varSum,
    variance_pct: prodSum > 0
      ? Number(((varSum / prodSum) * 100).toFixed(2))
      : '',
    last_activity: '',
  });
  // Blank divider between sections
  exportRows.push({
    quality: '', mode: '',
    produced_m: '', delivered_m: '', variance_m: '', variance_pct: '',
    last_activity: '',
  });
}
// Grand total row
exportRows.push({
  quality: 'GRAND TOTAL', mode: '',
  produced_m:   totalProduced,
  delivered_m:  totalDelivered,
  variance_m:   netVariance,
  variance_pct: totalProduced > 0
    ? Number(((netVariance / totalProduced) * 100).toFixed(2))
    : '',
  last_activity: '',
});
```

- [ ] **Step 4.3: Render the export button beside the page header**

Find the `<PageHeader …>` element. Replace it with this version that supplies an `actions` slot:

```tsx
<PageHeader
  title="Production vs Delivery"
  subtitle="Per-quality comparison of metres produced (shift logs / fabric receipts) vs metres delivered on DCs. Variance flags where production is drifting from dispatch."
  crumbs={[
    { label: 'Reports', href: '/app/reports' },
    { label: 'Production vs Delivery' },
  ]}
  actions={
    <ExcelExportButton
      filename={`production-vs-delivery-${from}-to-${to}`}
      sheetName="Production vs Delivery"
      title={`Production vs Delivery — ${from} to ${to}`}
      columns={exportColumns}
      rows={exportRows}
    />
  }
/>
```

- [ ] **Step 4.4: Smoke test the export**

In the browser, on the new page, click the export button. The download should be `production-vs-delivery-YYYY-MM-DD-to-YYYY-MM-DD.xlsx`. Open it in Excel / Numbers / Google Sheets. Confirm:
- One sheet "Production vs Delivery" with a bold title row.
- Each section starts with the quality code/name as a single cell in column A (the rest of that row is blank).
- Three sub-rows (In-house / Job Work / Outsource) showing only the modes that had activity.
- A "Quality total" row at the end of each section.
- A blank divider row between sections.
- A final "GRAND TOTAL" row at the bottom whose numbers match the on-screen KPI strip.

- [ ] **Step 4.5: Commit the export**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/app/app/reports/production-vs-delivery/page.tsx'
git commit -m "feat(reports): Production vs Delivery — Excel export

Quality-grouped sections (header + 3 mode rows + quality total +
divider), with a grand total at the bottom. Reuses the existing
ExcelExportButton + /app/api/reports/export route. Variance % is
recomputed from the section totals so the grouped numbers round
correctly."
```

---

## Task 5: Add the link card on the Reports index

**Files:**
- Modify: `app/app/app/reports/page.tsx`

- [ ] **Step 5.1: Find the existing array of report-card entries**

Open `app/app/app/reports/page.tsx`. Around line 50–100 you'll see a list of objects each shaped like `{ href, title, description, ready }`. They drive the cards on the Reports index.

- [ ] **Step 5.2: Insert the new card right after the "Variance Dashboard" entry**

Find the entry whose `title` is `'Variance Dashboard'`. Right after its closing `},`, paste:

```typescript
  {
    href: '/app/reports/production-vs-delivery',
    title: 'Production vs Delivery',
    description:
      'Per-quality variance between metres produced (shift logs for in-house; fabric receipts for jobwork & outsource) and metres delivered on DCs. Flags qualities where production is drifting from dispatch.',
    ready: true,
  },
```

- [ ] **Step 5.3: Smoke test the index**

Reload `/app/reports` in the browser. A new card titled "Production vs Delivery" should appear in the grid, between Variance Dashboard and Loom Utilisation. Clicking it should take you to the new report.

- [ ] **Step 5.4: Commit the index card**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git add 'app/app/app/reports/page.tsx'
git commit -m "feat(reports): index card for Production vs Delivery"
```

---

## Task 6: Push + production verification

**Files:** (none)

- [ ] **Step 6.1: Push everything**

```powershell
cd "C:\Users\Admin\Dropbox\PPK TEX\ERP\ppk_tex_erp"
git push origin main
```

Wait for the Vercel build to go green. If the build fails with a TypeScript error referencing `production_mode` typing or the `bobbin` table again, paste the build log into a new conversation — same `(supabase as any)` cast pattern usually resolves it.

- [ ] **Step 6.2: Open `/app/reports/production-vs-delivery?preset=this_month`**

In the deployed app, confirm:
- The Production vs Delivery card on the Reports index opens this page.
- The default window is the current month.
- Mode pills change the URL + filter the table.
- Quick presets (This month / Last month / Quarter / FY-to-date / Last 30d) reload with the new window.
- Quality cells link out to `/app/warehouse/fabric/[qualityId]`.

- [ ] **Step 6.3: Verify the FY-to-date numbers reconcile**

Click `FY-to-date`. The Net Variance KPI should equal `produced − delivered`. By hand, run in Supabase SQL editor:

```sql
SELECT SUM(produced_m) - SUM(delivered_m) AS net_variance_check
FROM public.fn_production_vs_delivery('2026-04-01', CURRENT_DATE);
```

This number should equal the Net Variance shown on the KPI strip (within ₹0.01 rounding) when the mode pill is set to `All`.

- [ ] **Step 6.4: Verify Excel export end-to-end on production**

In the deployed app, click the Excel export button at the top of the page. The download should be `production-vs-delivery-2026-04-01-to-2026-MM-DD.xlsx`. Open it and confirm the grand-total row numbers match the on-screen KPI strip.

- [ ] **Step 6.5: Mark plan complete**

All checkboxes ticked. Spec acceptance criteria met (per-quality variance with in-house / jobwork / outsource split; shift logs for in-house production; fabric receipts for jobwork/outsource; DC items for delivery; period-scoped picker; mode filter pills; quality-grouped Excel export).

---

## Self-Review Notes

- **Spec coverage:** Goal, Constraints, Decisions 1–7, Data Sources (all three modes + the unattributed fallback), UI (period picker + mode pills + KPI strip + table + Excel-grouped sections), Edge Cases (unattributed, batch boundary, draft DC, all-zero rows, negative variance), Implementation files (migration 149 + page + index card), Testing (manual reconciliation against the function output), Out-of-scope (no loom-level breakdown, no multi-period compare) — all mapped to tasks above.
- **No placeholders:** every code step contains the exact code to write. No "TBD" / "similar to above" / "handle edge cases" hand-waves.
- **Type consistency:** `PvDRow` field names match the function's RETURNS TABLE columns one-for-one; the `production_mode` union `'inhouse' | 'jobwork' | 'outsource' | 'unattributed'` is used everywhere; the `modeFilter` union `'all' | 'inhouse' | 'jobwork' | 'outsource'` is reused in the page + filter + URL builder.
- **Verification gates:** Step 1.3 + 1.4 confirm the function returns sensible numbers before any page code lands. Step 3.7 + 4.4 are local browser smoke checks. Step 6.3 reconciles totals against a direct SQL probe on the deployed DB.
