/**
 * Weaver-wise Quality-wise Production Report
 *
 * For a selected week, shows each weaver's total metres woven broken down
 * by fabric quality (loom.fabric_quality_id -> fabric_quality.code/name).
 *
 * Rows    = weaver (metre-basis employees only)
 * Columns = one column per quality present in the week + a Total column
 *
 * Looms with no fabric_quality_id assigned appear under "No Quality".
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const metadata = { title: 'Weaver Production by Quality' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ week?: string }>;
}

/** Format a local Date as YYYY-MM-DD without UTC conversion. */
function localISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function mondayISO(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + offset);
  return localISO(copy);
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, day ?? 1);
  dt.setDate(dt.getDate() + days);
  return localISO(dt);
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function prettyDate(iso: string): string {
  const [yStr, mStr, dStr] = iso.split('-');
  const d = Number(dStr);
  const month = MONTHS[Number(mStr) - 1] ?? '';
  return `${d} ${month} ${yStr}`;
}
function prettyRange(start: string, end: string): string {
  const [, sm, sd] = start.split('-');
  const [, em, ed] = end.split('-');
  if (sm === em) {
    return `${Number(sd)} - ${Number(ed)} ${MONTHS[Number(sm) - 1] ?? ''} ${end.split('-')[0]}`;
  }
  return `${prettyDate(start)} - ${prettyDate(end)}`;
}

function fmtNum(n: number, decimals = 1): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface RawRow {
  employee_id: number;
  full_name: string;
  code: string;
  quality_code: string;
  quality_name: string;
  total_metres: number;
}

export default async function WeaverProductionReport({ searchParams }: PageProps) {
  const { week } = await searchParams;
  const requested = typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week)
    ? week
    : mondayISO(new Date());

  const weekStart = mondayISO(new Date(requested + 'T00:00:00'));
  const weekEnd   = addDaysISO(weekStart, 6);
  const prevWeek  = addDaysISO(weekStart, -7);
  const nextWeek  = addDaysISO(weekStart, 7);
  const thisWeek  = mondayISO(new Date());

  const supabase = await createClient();

  // Step 1: All shift logs in the selected week (get id + loom_id).
  const { data: shiftLogsRaw } = await supabase
    .from('production_shift_log')
    .select('id, loom_id')
    .gte('log_date', weekStart)
    .lte('log_date', weekEnd);
  const shiftLogs = (shiftLogsRaw ?? []) as Array<{ id: number; loom_id: number }>;

  const rows: RawRow[] = [];

  if (shiftLogs.length > 0) {
    const shiftLogIds = shiftLogs.map((s) => s.id);
    const loomByShift = new Map<number, number>();
    for (const s of shiftLogs) loomByShift.set(s.id, s.loom_id);

    // Step 2: Weaver entries for those shift logs.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weaverRaw } = await (supabase as any)
      .from('production_shift_log_weaver')
      .select('shift_log_id, employee_id, metres_woven')
      .in('shift_log_id', shiftLogIds);
    type WeaverEntry = { shift_log_id: number; employee_id: number; metres_woven: number | string | null };
    const weaverEntries = (weaverRaw ?? []) as WeaverEntry[];

    // Step 3: Look up every employee that appears in the shift logs.
    //
    // We deliberately do NOT filter by wage_alloc_basis = 'metres' here.
    // A weaver who logs metres on a loom is a weaver on the report, no
    // matter how their wages are calculated (weekly, daily, metres, etc.).
    // Filtering earlier was hiding weeks where a fill-in or weekly-basis
    // person ran a loom, and silently dropped their production from the
    // pivot.
    const empIds = Array.from(new Set(weaverEntries.map((w) => w.employee_id)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: empRaw } = empIds.length ? await (supabase as any)
      .from('employee')
      .select('id, full_name, code')
      .in('id', empIds)
      : { data: [] };
    const knownEmpIds = new Set<number>();
    const empInfo = new Map<number, { full_name: string; code: string }>();
    for (const e of (empRaw ?? []) as Array<{ id: number; full_name: string; code: string }>) {
      knownEmpIds.add(e.id);
      empInfo.set(e.id, { full_name: e.full_name, code: e.code });
    }

    // Step 4: Loom fabric_quality mapping.
    const loomIds = Array.from(new Set(shiftLogs.map((s) => s.loom_id)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: loomRaw } = await (supabase as any)
      .from('loom')
      .select('id, fabric_quality:fabric_quality_id ( code, name )')
      .in('id', loomIds);
    type LoomRow = { id: number; fabric_quality: { code: string; name: string } | null };
    const qualityByLoom = new Map<number, { code: string; name: string }>();
    for (const l of (loomRaw ?? []) as LoomRow[]) {
      qualityByLoom.set(l.id, l.fabric_quality ?? { code: 'NO_QUALITY', name: 'No Quality Assigned' });
    }

    // Step 5: Aggregate metres per (employee, quality).
    const grouped = new Map<string, { employee_id: number; full_name: string; code: string; quality_code: string; quality_name: string; total: number }>();
    for (const w of weaverEntries) {
      const loomId = loomByShift.get(w.shift_log_id);
      if (loomId == null) continue;
      const fq = qualityByLoom.get(loomId) ?? { code: 'NO_QUALITY', name: 'No Quality Assigned' };
      const key = `${w.employee_id}|${fq.code}`;
      const m = Number(w.metres_woven ?? 0);
      if (m <= 0) continue;
      // Use the real name when we have it; fall back to the employee code
      // or the bare id so production is never silently dropped from the
      // report just because the employee record is missing.
      const emp = empInfo.get(w.employee_id);
      const full_name = emp?.full_name ?? `Emp ${w.employee_id}`;
      const code = emp?.code ?? '';
      const existing = grouped.get(key);
      if (existing) {
        existing.total += m;
      } else {
        grouped.set(key, { employee_id: w.employee_id, full_name, code, quality_code: fq.code, quality_name: fq.name, total: m });
      }
    }
    for (const r of grouped.values()) {
      rows.push({ employee_id: r.employee_id, full_name: r.full_name, code: r.code, quality_code: r.quality_code, quality_name: r.quality_name, total_metres: r.total });
    }
  }

  // Collect distinct qualities (sorted by code)
  const qualityMap = new Map<string, string>();
  for (const r of rows) {
    if (!qualityMap.has(r.quality_code)) {
      qualityMap.set(r.quality_code, r.quality_name);
    }
  }
  const qualities = Array.from(qualityMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, name]) => ({ code, name }));

  // Build weaver pivot
  interface WeaverData {
    employee_id: number;
    full_name: string;
    code: string;
    byQuality: Map<string, number>;
    total: number;
  }
  const weaverMap = new Map<number, WeaverData>();
  for (const r of rows) {
    let w = weaverMap.get(r.employee_id);
    if (!w) {
      w = { employee_id: r.employee_id, full_name: r.full_name, code: r.code, byQuality: new Map(), total: 0 };
      weaverMap.set(r.employee_id, w);
    }
    w.byQuality.set(r.quality_code, (w.byQuality.get(r.quality_code) ?? 0) + Number(r.total_metres));
    w.total += Number(r.total_metres);
  }
  const weavers = Array.from(weaverMap.values()).sort((a, b) => a.full_name.localeCompare(b.full_name));

  // Column totals
  const colTotals = new Map<string, number>();
  let grandTotal = 0;
  for (const w of weavers) {
    for (const q of qualities) {
      const m = w.byQuality.get(q.code) ?? 0;
      colTotals.set(q.code, (colTotals.get(q.code) ?? 0) + m);
    }
    grandTotal += w.total;
  }

  const hasData = weavers.length > 0;

  return (
    <div>
      <PageHeader
        title="Weaver Production by Quality"
        subtitle={prettyRange(weekStart, weekEnd)}
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Weaver Production' }]}
      />

      {/* Week navigator */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/app/reports/weaver-production?week=${prevWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Previous week
        </Link>
        <Link
          href={`/app/reports/weaver-production?week=${nextWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          Next week <ChevronRight className="w-3.5 h-3.5" />
        </Link>
        <Link
          href={`/app/reports/weaver-production?week=${thisWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          This week
        </Link>
        <form action="/app/reports/weaver-production" method="get" className="ml-auto flex items-center gap-2">
          <label htmlFor="jump" className="text-xs text-ink-mute">Jump to week:</label>
          <input
            id="jump"
            name="week"
            type="date"
            defaultValue={weekStart}
            className="input py-1 text-xs max-w-[160px]"
          />
          <button type="submit" className="btn-secondary text-xs py-1 px-2">Go</button>
        </form>
      </div>

      {!hasData ? (
        <div className="card p-10 text-center text-ink-mute text-sm">
          No shift log data found for this week.
        </div>
      ) : (
        <>
          {/* Summary KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Weavers</div>
              <div className="num text-xl font-bold">{weavers.length}</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Qualities</div>
              <div className="num text-xl font-bold">{qualities.length}</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total metres</div>
              <div className="num text-xl font-bold">{fmtNum(grandTotal)} m</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wide text-ink-mute">Avg per weaver</div>
              <div className="num text-xl font-bold">{fmtNum(weavers.length ? grandTotal / weavers.length : 0)} m</div>
            </div>
          </div>

          {/* Pivot table */}
          <div className="card overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-3 sticky left-0 bg-cloud/60 min-w-[180px]">Weaver</th>
                  {qualities.map(q => (
                    <th key={q.code} className="text-right px-3 py-3 whitespace-nowrap" title={q.name}>
                      {q.code === 'NO_QUALITY' ? 'No Quality' : q.code}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3 font-bold">Total (m)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {weavers.map(w => (
                  <tr key={w.employee_id} className="hover:bg-haze/40">
                    <td className="px-4 py-2.5 sticky left-0 bg-white hover:bg-haze/40">
                      <div className="font-medium">{w.full_name}</div>
                      <div className="text-[11px] text-ink-mute">{w.code}</div>
                    </td>
                    {qualities.map(q => {
                      const m = w.byQuality.get(q.code) ?? 0;
                      return (
                        <td key={q.code} className="px-3 py-2.5 text-right num text-ink-soft">
                          {m > 0 ? fmtNum(m) : <span className="text-ink-mute/40">{'\u2014'}</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right num font-semibold">{fmtNum(w.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft font-semibold">
                <tr>
                  <td className="px-4 py-2.5 sticky left-0 bg-cloud/30">Total</td>
                  {qualities.map(q => (
                    <td key={q.code} className="px-3 py-2.5 text-right num">
                      {fmtNum(colTotals.get(q.code) ?? 0)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right num font-bold text-ink">{fmtNum(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Quality breakdown legend */}
          {qualities.some(q => q.code !== 'NO_QUALITY') && (
            <div className="card p-4">
              <h2 className="text-xs font-semibold text-ink-mute uppercase tracking-wide mb-2">Quality legend</h2>
              <div className="flex flex-wrap gap-4">
                {qualities.filter(q => q.code !== 'NO_QUALITY').map(q => (
                  <div key={q.code} className="text-sm">
                    <span className="font-semibold">{q.code}</span>
                    <span className="text-ink-mute ml-1">- {q.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
