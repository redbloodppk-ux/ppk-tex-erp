/**
 * Total Production from Shift Log
 *
 * "How many metres did we weave?" — answered for any range, narrowed by
 * shed, weaver and fabric quality. The four period flavours match how the
 * mill thinks about time:
 *
 *   day   - one calendar date         (default = today)
 *   week  - Monday -> Sunday          (default = current week)
 *   month - 1st -> last day of month  (default = current month)
 *   fy    - 1 Apr YYYY -> 31 Mar YYYY (default = current Indian FY)
 *
 * Data flow:
 *   production_shift_log      (one row per loom-shift)
 *     -> production_shift_log_weaver  (metres per weaver per loom-shift)
 *     -> loom (shed_no, fabric_quality_id)
 *     -> fabric_quality (code, name)
 *
 * The breakdown table buckets metres by date for day/week/month and by
 * month for FY (so the FY view stays at ~12 rows max).
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const metadata = { title: 'Production Report' };
export const dynamic = 'force-dynamic';

type PeriodKind = 'day' | 'week' | 'month' | 'fy';

interface PageProps {
  searchParams: Promise<{
    period?: string;
    date?: string;
    shed?: string;
    weaver?: string;
    quality?: string;
  }>;
}

// ──────────────────────────────────────────────────────────────────────────
// Date helpers — all local, no UTC conversion
// ──────────────────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, '0'); }

function localISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function todayISO(): string {
  return localISO(new Date());
}

function addDaysISO(iso: string, days: number): string {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + days);
  return localISO(dt);
}

function mondayISO(iso: string): string {
  const dt = parseISO(iso);
  const dow = dt.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  dt.setDate(dt.getDate() + offset);
  return localISO(dt);
}

function monthStartISO(iso: string): string {
  const dt = parseISO(iso);
  return localISO(new Date(dt.getFullYear(), dt.getMonth(), 1));
}

function monthEndISO(iso: string): string {
  const dt = parseISO(iso);
  return localISO(new Date(dt.getFullYear(), dt.getMonth() + 1, 0));
}

/** Indian FY: 1 Apr YYYY -> 31 Mar YYYY+1. For a date before Apr it
 *  belongs to the previous FY. */
function fyStartISO(iso: string): string {
  const dt = parseISO(iso);
  const y = dt.getMonth() < 3 ? dt.getFullYear() - 1 : dt.getFullYear();
  return `${y}-04-01`;
}

function fyEndISO(iso: string): string {
  const dt = parseISO(iso);
  const y = dt.getMonth() < 3 ? dt.getFullYear() : dt.getFullYear() + 1;
  return `${y}-03-31`;
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function prettyDate(iso: string): string {
  const [yStr, mStr, dStr] = iso.split('-');
  return `${Number(dStr)} ${MONTHS[Number(mStr) - 1] ?? ''} ${yStr}`;
}

function prettyRange(start: string, end: string): string {
  if (start === end) return prettyDate(start);
  const [sy, sm, sd] = start.split('-');
  const [ey, em, ed] = end.split('-');
  if (sy === ey && sm === em) {
    return `${Number(sd)} - ${Number(ed)} ${MONTHS[Number(sm) - 1] ?? ''} ${sy}`;
  }
  if (sy === ey) {
    return `${Number(sd)} ${MONTHS[Number(sm) - 1] ?? ''} - ${Number(ed)} ${MONTHS[Number(em) - 1] ?? ''} ${sy}`;
  }
  return `${prettyDate(start)} - ${prettyDate(end)}`;
}

function fyLabel(iso: string): string {
  const startYear = Number(fyStartISO(iso).split('-')[0]);
  return `FY ${startYear}-${String(startYear + 1).slice(-2)}`;
}

function periodLabel(kind: PeriodKind, start: string, end: string): string {
  switch (kind) {
    case 'day':   return prettyDate(start);
    case 'week':  return prettyRange(start, end);
    case 'month': {
      const [y, m] = start.split('-');
      return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
    }
    case 'fy':    return fyLabel(start);
  }
}

function fmtNum(n: number, decimals = 1): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-IN');
}

// ──────────────────────────────────────────────────────────────────────────
// Period math
// ──────────────────────────────────────────────────────────────────────────

interface PeriodRange {
  kind: PeriodKind;
  start: string;
  end: string;
  prev: string; // ref date that shifts one period back
  next: string; // ref date that shifts one period forward
  ref: string;  // canonical ref date for "this" link (today)
}

function computeRange(kind: PeriodKind, refIso: string): PeriodRange {
  switch (kind) {
    case 'day': {
      return {
        kind,
        start: refIso,
        end: refIso,
        prev: addDaysISO(refIso, -1),
        next: addDaysISO(refIso, 1),
        ref: todayISO(),
      };
    }
    case 'week': {
      const start = mondayISO(refIso);
      const end = addDaysISO(start, 6);
      return {
        kind,
        start,
        end,
        prev: addDaysISO(start, -7),
        next: addDaysISO(start, 7),
        ref: todayISO(),
      };
    }
    case 'month': {
      const start = monthStartISO(refIso);
      const end = monthEndISO(refIso);
      const prevDate = parseISO(start);
      prevDate.setMonth(prevDate.getMonth() - 1);
      const nextDate = parseISO(start);
      nextDate.setMonth(nextDate.getMonth() + 1);
      return {
        kind,
        start,
        end,
        prev: localISO(prevDate),
        next: localISO(nextDate),
        ref: todayISO(),
      };
    }
    case 'fy': {
      const start = fyStartISO(refIso);
      const end = fyEndISO(refIso);
      const startYear = Number(start.split('-')[0]);
      return {
        kind,
        start,
        end,
        prev: `${startYear - 1}-04-01`,
        next: `${startYear + 1}-04-01`,
        ref: todayISO(),
      };
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Data fetch + aggregation
// ──────────────────────────────────────────────────────────────────────────

const SHEDS = [1, 2, 3, 4] as const;

interface LoomMeta {
  id: number;
  loom_code: string | null;
  shed_no: number | null;
  fabric_quality_id: number | null;
}

interface QualityMeta {
  id: number;
  code: string;
  name: string;
}

interface EmployeeMeta {
  id: number;
  code: string;
  full_name: string;
}

interface ShiftLogRow {
  id: number;
  loom_id: number;
  log_date: string;
  shift: 'day' | 'night';
}

interface WeaverRow {
  shift_log_id: number;
  employee_id: number;
  metres_woven: number | string | null;
}

interface AggregatedRow {
  bucket: string;          // YYYY-MM-DD for day rows, YYYY-MM for FY months
  bucketLabel: string;     // display label
  metres: number;
  shiftLogs: number;
}

interface BreakdownTotals {
  metres: number;
  shiftLogIds: Set<number>;
  weaverIds: Set<number>;
  shedNos: Set<number>;
  qualityIds: Set<number>;
}

// ──────────────────────────────────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────────────────────────────────

export default async function ProductionReportPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const kind: PeriodKind = (['day','week','month','fy'] as const).includes(sp.period as PeriodKind)
    ? (sp.period as PeriodKind)
    : 'week';

  const refIso = typeof sp.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.date)
    ? sp.date
    : todayISO();

  const range = computeRange(kind, refIso);

  const shedFilter   = sp.shed    && /^\d+$/.test(sp.shed)    ? Number(sp.shed)    : null;
  const weaverFilter = sp.weaver  && /^\d+$/.test(sp.weaver)  ? Number(sp.weaver)  : null;
  const qualityFilter= sp.quality && /^\d+$/.test(sp.quality) ? Number(sp.quality) : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // ───── Dropdown option lists (always loaded for the filter bar) ─────
  const [loomRes, qualityRes, weaverOptsRes] = await Promise.all([
    sb.from('loom').select('id, loom_code, shed_no, fabric_quality_id'),
    sb.from('fabric_quality').select('id, code, name').order('code'),
    sb.from('employee')
      .select('id, code, full_name, wage_alloc_basis')
      .eq('wage_alloc_basis', 'metres')
      .order('full_name'),
  ]);
  const allLooms     = (loomRes.data ?? []) as LoomMeta[];
  const allQualities = (qualityRes.data ?? []) as QualityMeta[];
  const allWeavers   = ((weaverOptsRes.data ?? []) as Array<EmployeeMeta & { wage_alloc_basis: string }>)
    .map((w) => ({ id: w.id, code: w.code, full_name: w.full_name }));

  const qualityById = new Map<number, QualityMeta>();
  for (const q of allQualities) qualityById.set(q.id, q);

  const loomById = new Map<number, LoomMeta>();
  for (const l of allLooms) loomById.set(l.id, l);

  // ───── Pre-filter looms by shed / quality so the shift-log query is cheap ─────
  const eligibleLoomIds = allLooms
    .filter((l) => {
      if (shedFilter !== null && l.shed_no !== shedFilter) return false;
      if (qualityFilter !== null && l.fabric_quality_id !== qualityFilter) return false;
      return true;
    })
    .map((l) => l.id);

  // ───── Shift logs in range, narrowed to eligible looms ─────
  let shiftLogs: ShiftLogRow[] = [];
  if (eligibleLoomIds.length > 0) {
    const logsRes = await sb
      .from('production_shift_log')
      .select('id, loom_id, log_date, shift')
      .gte('log_date', range.start)
      .lte('log_date', range.end)
      .in('loom_id', eligibleLoomIds);
    shiftLogs = (logsRes.data ?? []) as ShiftLogRow[];
  }

  // ───── Weaver rows for those logs, narrowed by weaver filter ─────
  let weaverRows: WeaverRow[] = [];
  if (shiftLogs.length > 0) {
    const shiftLogIds = shiftLogs.map((s) => s.id);
    let q = sb
      .from('production_shift_log_weaver')
      .select('shift_log_id, employee_id, metres_woven')
      .in('shift_log_id', shiftLogIds);
    if (weaverFilter !== null) q = q.eq('employee_id', weaverFilter);
    const wRes = await q;
    weaverRows = (wRes.data ?? []) as WeaverRow[];
  }

  const shiftLogById = new Map<number, ShiftLogRow>();
  for (const s of shiftLogs) shiftLogById.set(s.id, s);

  // ───── Aggregations ─────
  const totals: BreakdownTotals = {
    metres: 0,
    shiftLogIds: new Set(),
    weaverIds: new Set(),
    shedNos: new Set(),
    qualityIds: new Set(),
  };

  /** key = bucket string. value = { metres, shiftLogIds } */
  const byBucket = new Map<string, { metres: number; shiftLogIds: Set<number> }>();
  /** key = shed_no. */
  const byShed = new Map<number, { metres: number; shiftLogIds: Set<number> }>();
  /** key = fabric_quality_id (or 0 = none). */
  const byQuality = new Map<number, { metres: number; shiftLogIds: Set<number> }>();
  /** key = employee_id. */
  const byWeaver = new Map<number, { metres: number; shiftLogIds: Set<number> }>();

  function bucketKey(log_date: string): string {
    return kind === 'fy' ? log_date.slice(0, 7) : log_date; // YYYY-MM for FY, else YYYY-MM-DD
  }

  for (const w of weaverRows) {
    const log = shiftLogById.get(w.shift_log_id);
    if (!log) continue;
    const loom = loomById.get(log.loom_id);
    if (!loom) continue;

    const metres = Number(w.metres_woven ?? 0);
    if (!Number.isFinite(metres) || metres <= 0) continue;

    totals.metres += metres;
    totals.shiftLogIds.add(log.id);
    totals.weaverIds.add(w.employee_id);
    if (loom.shed_no != null) totals.shedNos.add(loom.shed_no);
    if (loom.fabric_quality_id != null) totals.qualityIds.add(loom.fabric_quality_id);

    const bKey = bucketKey(log.log_date);
    const b = byBucket.get(bKey) ?? { metres: 0, shiftLogIds: new Set<number>() };
    b.metres += metres;
    b.shiftLogIds.add(log.id);
    byBucket.set(bKey, b);

    if (loom.shed_no != null) {
      const s = byShed.get(loom.shed_no) ?? { metres: 0, shiftLogIds: new Set<number>() };
      s.metres += metres;
      s.shiftLogIds.add(log.id);
      byShed.set(loom.shed_no, s);
    }

    const qId = loom.fabric_quality_id ?? 0;
    const qa = byQuality.get(qId) ?? { metres: 0, shiftLogIds: new Set<number>() };
    qa.metres += metres;
    qa.shiftLogIds.add(log.id);
    byQuality.set(qId, qa);

    const wa = byWeaver.get(w.employee_id) ?? { metres: 0, shiftLogIds: new Set<number>() };
    wa.metres += metres;
    wa.shiftLogIds.add(log.id);
    byWeaver.set(w.employee_id, wa);
  }

  // Sorted breakdown rows for the table
  const breakdown: AggregatedRow[] = Array.from(byBucket.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, v]): AggregatedRow => {
      const label = kind === 'fy'
        ? (() => {
            const [y, m] = bucket.split('-');
            return `${MONTHS[Number(m) - 1] ?? ''} ${y}`;
          })()
        : prettyDate(bucket);
      return {
        bucket,
        bucketLabel: label,
        metres: v.metres,
        shiftLogs: v.shiftLogIds.size,
      };
    });

  // Weaver name lookup for top-performers card. We seed the map from the
  // dropdown options (metre-basis employees), but the shift log can hold
  // entries from anyone — including weekly/daily-basis fill-ins and people
  // whose wage_alloc_basis was changed after the log was written. So we
  // also fetch the missing IDs directly by id, with no basis filter, to
  // make sure every weaver gets their real name on the report instead of
  // falling back to "Emp <id>".
  const weaverNameById = new Map<number, EmployeeMeta>();
  for (const w of allWeavers) weaverNameById.set(w.id, w);

  const missingIds = Array.from(byWeaver.keys()).filter((id) => !weaverNameById.has(id));
  if (missingIds.length > 0) {
    const { data: extraEmps } = await sb
      .from('employee')
      .select('id, code, full_name')
      .in('id', missingIds);
    for (const e of (extraEmps ?? []) as EmployeeMeta[]) {
      weaverNameById.set(e.id, e);
    }
  }

  // Top weavers (descending metres)
  const topWeavers = Array.from(byWeaver.entries())
    .map(([id, v]) => ({
      id,
      name: weaverNameById.get(id)?.full_name ?? `Emp ${id}`,
      code: weaverNameById.get(id)?.code ?? '',
      metres: v.metres,
      shiftLogs: v.shiftLogIds.size,
    }))
    .sort((a, b) => b.metres - a.metres);

  const hasData = totals.metres > 0;

  // ───── URL builders for filter chips + nav ─────
  function buildHref(overrides: Partial<{ period: PeriodKind; date: string; shed: string; weaver: string; quality: string }>): string {
    const params = new URLSearchParams();
    params.set('period', overrides.period ?? kind);
    params.set('date',   overrides.date   ?? refIso);
    const sh = overrides.shed    !== undefined ? overrides.shed    : (shedFilter    !== null ? String(shedFilter)    : '');
    const we = overrides.weaver  !== undefined ? overrides.weaver  : (weaverFilter  !== null ? String(weaverFilter)  : '');
    const qu = overrides.quality !== undefined ? overrides.quality : (qualityFilter !== null ? String(qualityFilter) : '');
    if (sh) params.set('shed', sh);
    if (we) params.set('weaver', we);
    if (qu) params.set('quality', qu);
    return `/app/reports/production?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Total Production"
        subtitle={periodLabel(kind, range.start, range.end)}
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Total Production' }]}
      />

      {/* ───── Filter bar ───── */}
      <div className="card p-3 mb-4 space-y-3">
        {/* Period kind chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-ink-mute mr-1">Period:</span>
          {(['day','week','month','fy'] as const).map((k) => (
            <Link
              key={k}
              href={buildHref({ period: k, date: refIso })}
              className={
                'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ' +
                (kind === k
                  ? 'border-indigo bg-indigo/10 text-indigo'
                  : 'border-line bg-white text-ink-soft hover:bg-haze/60')
              }
            >
              {k === 'fy' ? 'Financial Year' : k.charAt(0).toUpperCase() + k.slice(1)}
            </Link>
          ))}
        </div>

        {/* Period navigator + ref-date input + filters */}
        <form action="/app/reports/production" method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value={kind} />

          <Link
            href={buildHref({ date: range.prev })}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </Link>
          <Link
            href={buildHref({ date: range.next })}
            className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </Link>
          <Link
            href={buildHref({ date: range.ref })}
            className="inline-flex items-center rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
          >
            This {kind === 'fy' ? 'FY' : kind}
          </Link>

          <div className="flex flex-col">
            <label htmlFor="date" className="text-[10px] uppercase tracking-wide text-ink-mute">Reference date</label>
            <input
              id="date"
              name="date"
              type="date"
              defaultValue={refIso}
              className="input py-1 text-xs max-w-[150px]"
            />
          </div>

          <div className="flex flex-col">
            <label htmlFor="shed" className="text-[10px] uppercase tracking-wide text-ink-mute">Shed</label>
            <select
              id="shed"
              name="shed"
              defaultValue={shedFilter !== null ? String(shedFilter) : ''}
              className="input py-1 text-xs max-w-[110px]"
            >
              <option value="">All sheds</option>
              {SHEDS.map((s) => <option key={s} value={s}>Shed {s}</option>)}
            </select>
          </div>

          <div className="flex flex-col">
            <label htmlFor="weaver" className="text-[10px] uppercase tracking-wide text-ink-mute">Weaver</label>
            <select
              id="weaver"
              name="weaver"
              defaultValue={weaverFilter !== null ? String(weaverFilter) : ''}
              className="input py-1 text-xs max-w-[180px]"
            >
              <option value="">All weavers</option>
              {allWeavers.map((w) => (
                <option key={w.id} value={w.id}>{w.full_name} ({w.code})</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col">
            <label htmlFor="quality" className="text-[10px] uppercase tracking-wide text-ink-mute">Quality</label>
            <select
              id="quality"
              name="quality"
              defaultValue={qualityFilter !== null ? String(qualityFilter) : ''}
              className="input py-1 text-xs max-w-[180px]"
            >
              <option value="">All qualities</option>
              {allQualities.map((q) => (
                <option key={q.id} value={q.id}>{q.code} - {q.name}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
          {(shedFilter !== null || weaverFilter !== null || qualityFilter !== null) && (
            <Link
              href={buildHref({ shed: '', weaver: '', quality: '' })}
              className="text-xs text-ink-mute hover:text-ink underline"
            >
              Clear
            </Link>
          )}
        </form>
      </div>

      {/* ───── KPI cards ───── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mb-4">
        <KpiCard label="Total metres" value={fmtNum(totals.metres)} suffix="m" highlight />
        <KpiCard label="Shift logs"   value={fmtInt(totals.shiftLogIds.size)} />
        <KpiCard label="Sheds active" value={fmtInt(totals.shedNos.size)} />
        <KpiCard label="Weavers"      value={fmtInt(totals.weaverIds.size)} />
        <KpiCard label="Qualities"    value={fmtInt(totals.qualityIds.size)} />
        <KpiCard
          label="Avg / shift log"
          value={totals.shiftLogIds.size > 0 ? fmtNum(totals.metres / totals.shiftLogIds.size) : '0.0'}
          suffix="m"
        />
      </div>

      {!hasData ? (
        <div className="card p-10 text-center text-ink-mute text-sm">
          No production logged for the chosen filters.
        </div>
      ) : (
        <>
          {/* ───── Breakdown table ───── */}
          <div className="card overflow-x-auto mb-4">
            <div className="flex items-center justify-between px-4 py-3 border-b border-line/60 bg-cloud/40">
              <h2 className="font-display font-bold text-sm">
                {kind === 'fy' ? 'Monthly breakdown' : 'Daily breakdown'}
              </h2>
              <span className="text-xs text-ink-mute">{breakdown.length} row{breakdown.length === 1 ? '' : 's'}</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-2.5">{kind === 'fy' ? 'Month' : 'Date'}</th>
                  <th className="text-right px-4 py-2.5">Shift logs</th>
                  <th className="text-right px-4 py-2.5">Metres</th>
                  <th className="text-right px-4 py-2.5">Avg / log</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {breakdown.map((r) => (
                  <tr key={r.bucket} className="hover:bg-haze/40">
                    <td className="px-4 py-2 font-medium">{r.bucketLabel}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">{fmtInt(r.shiftLogs)}</td>
                    <td className="px-4 py-2 text-right num font-semibold">{fmtNum(r.metres)}</td>
                    <td className="px-4 py-2 text-right num text-ink-soft">
                      {r.shiftLogs > 0 ? fmtNum(r.metres / r.shiftLogs) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft font-semibold">
                <tr>
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right num">{fmtInt(totals.shiftLogIds.size)}</td>
                  <td className="px-4 py-2.5 text-right num text-ink">{fmtNum(totals.metres)}</td>
                  <td className="px-4 py-2.5 text-right num">
                    {totals.shiftLogIds.size > 0 ? fmtNum(totals.metres / totals.shiftLogIds.size) : '-'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ───── Per-shed + per-quality cards side-by-side ───── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* By shed */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
                <h2 className="font-display font-bold text-sm">By shed</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="text-left px-4 py-2.5">Shed</th>
                    <th className="text-right px-4 py-2.5">Shift logs</th>
                    <th className="text-right px-4 py-2.5">Metres</th>
                    <th className="text-right px-4 py-2.5">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {SHEDS.map((s) => {
                    const row = byShed.get(s);
                    const m = row?.metres ?? 0;
                    const logs = row?.shiftLogIds.size ?? 0;
                    const share = totals.metres > 0 ? (m / totals.metres) * 100 : 0;
                    return (
                      <tr key={s} className="hover:bg-haze/40">
                        <td className="px-4 py-2 font-medium">Shed {s}</td>
                        <td className="px-4 py-2 text-right num text-ink-soft">{fmtInt(logs)}</td>
                        <td className="px-4 py-2 text-right num font-semibold">{fmtNum(m)}</td>
                        <td className="px-4 py-2 text-right num text-ink-soft">{fmtNum(share, 1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* By quality */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
                <h2 className="font-display font-bold text-sm">By quality</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="text-left px-4 py-2.5">Quality</th>
                    <th className="text-right px-4 py-2.5">Shift logs</th>
                    <th className="text-right px-4 py-2.5">Metres</th>
                    <th className="text-right px-4 py-2.5">Share</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {Array.from(byQuality.entries())
                    .sort((a, b) => b[1].metres - a[1].metres)
                    .map(([qId, v]) => {
                      const q = qId > 0 ? qualityById.get(qId) : null;
                      const share = totals.metres > 0 ? (v.metres / totals.metres) * 100 : 0;
                      return (
                        <tr key={qId} className="hover:bg-haze/40">
                          <td className="px-4 py-2">
                            <div className="font-medium">{q ? q.code : 'No quality'}</div>
                            {q && <div className="text-[11px] text-ink-mute">{q.name}</div>}
                          </td>
                          <td className="px-4 py-2 text-right num text-ink-soft">{fmtInt(v.shiftLogIds.size)}</td>
                          <td className="px-4 py-2 text-right num font-semibold">{fmtNum(v.metres)}</td>
                          <td className="px-4 py-2 text-right num text-ink-soft">{fmtNum(share, 1)}%</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ───── Top weavers ───── */}
          <div className="card overflow-x-auto">
            <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
              <h2 className="font-display font-bold text-sm">By weaver</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-2.5">#</th>
                  <th className="text-left px-4 py-2.5">Weaver</th>
                  <th className="text-right px-4 py-2.5">Shift logs</th>
                  <th className="text-right px-4 py-2.5">Metres</th>
                  <th className="text-right px-4 py-2.5">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {topWeavers.map((w, idx) => {
                  const share = totals.metres > 0 ? (w.metres / totals.metres) * 100 : 0;
                  return (
                    <tr key={w.id} className="hover:bg-haze/40">
                      <td className="px-4 py-2 text-ink-mute text-xs">{idx + 1}</td>
                      <td className="px-4 py-2">
                        <div className="font-medium">{w.name}</div>
                        <div className="text-[11px] text-ink-mute">{w.code}</div>
                      </td>
                      <td className="px-4 py-2 text-right num text-ink-soft">{fmtInt(w.shiftLogs)}</td>
                      <td className="px-4 py-2 text-right num font-semibold">{fmtNum(w.metres)}</td>
                      <td className="px-4 py-2 text-right num text-ink-soft">{fmtNum(share, 1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Small UI bits
// ──────────────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string;
  suffix?: string;
  highlight?: boolean;
}

function KpiCard({ label, value, suffix, highlight = false }: KpiCardProps) {
  return (
    <div className={'card p-3 ' + (highlight ? 'bg-indigo/5 border-indigo/30' : '')}>
      <div className="text-[11px] uppercase tracking-wide text-ink-mute">{label}</div>
      <div className={'num font-bold ' + (highlight ? 'text-xl text-indigo' : 'text-xl')}>
        {value}{suffix ? <span className="text-sm ml-1 text-ink-mute">{suffix}</span> : null}
      </div>
    </div>
  );
}
