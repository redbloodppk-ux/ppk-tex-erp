/**
 * Weaver Wages by Quality
 *
 * Wage earned by each weaver on each fabric quality for a week, a month or a
 * financial year (or any custom range). Built from the shift log via
 * fn_weaver_quality_wages (aggregated in SQL, so a full year is one call):
 *
 *   metres  = as the weaver counted it (society saree: folding metres, 137 cm)
 *   wage    = real metres x the shift log's frozen rate (else loom default)
 *
 * Rows = weavers, columns = qualities; each cell shows the wage plus the
 * metres and rate behind it. Totals per weaver and per quality.
 */
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { todayIST } from '@/lib/utils';

export const metadata = { title: 'Weaver Wages by Quality' };
export const dynamic = 'force-dynamic';

type Period = 'week' | 'month' | 'year' | 'custom';

interface PageProps {
  searchParams: Promise<{
    period?: string; week?: string; month?: string; fy?: string;
    from?: string; to?: string; shed?: string; emp?: string;
  }>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHEDS = [1, 2, 3, 4] as const;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function pad(n: number): string { return String(n).padStart(2, '0'); }
function localISO(d: Date): string { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parseISO(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1); }
function addDays(s: string, n: number): string { const d = parseISO(s); d.setDate(d.getDate() + n); return localISO(d); }
function monday(s: string): string { const d = parseISO(s); const dow = d.getDay(); d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow)); return localISO(d); }
function lastDayOfMonth(y: number, m: number): number { return new Date(y, m, 0).getDate(); }
function pretty(s: string): string { const [y, m, d] = s.split('-'); return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''} ${y}`; }
function fyOf(s: string): number { const [y, m] = s.split('-').map(Number); return (m ?? 1) >= 4 ? (y ?? 0) : (y ?? 0) - 1; }
function fyLabel(fy: number): string { return `FY ${fy}-${String((fy + 1) % 100).padStart(2, '0')}`; }

function rupee(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function num(n: number, d = 1): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

interface Row {
  employee_id: number; full_name: string; emp_code: string | null;
  fabric_quality_id: number | null; quality_code: string; quality_name: string;
  count_unit_cm: number | string | null; shifts: number;
  metres: number | string; real_metres: number | string; wage: number | string;
  min_rate: number | string | null; max_rate: number | string | null;
}

export default async function WeaverWagesReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const today = todayIST();
  const period: Period = (['week', 'month', 'year', 'custom'] as const).includes(sp.period as Period)
    ? (sp.period as Period) : 'week';

  // ── Resolve the date range for the chosen period ──
  let from: string; let to: string; let label: string;
  let prevQs = ''; let nextQs = ''; let nowQs = '';
  if (period === 'month') {
    const ym = /^\d{4}-\d{2}$/.test(sp.month ?? '') ? sp.month! : today.slice(0, 7);
    const [y, m] = ym.split('-').map(Number) as [number, number];
    from = `${ym}-01`; to = `${ym}-${pad(lastDayOfMonth(y, m))}`;
    label = `${MONTHS[m - 1]} ${y}`;
    const p = m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
    const n = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
    prevQs = `period=month&month=${p}`; nextQs = `period=month&month=${n}`; nowQs = 'period=month';
  } else if (period === 'year') {
    const fy = /^\d{4}$/.test(sp.fy ?? '') ? Number(sp.fy) : fyOf(today);
    from = `${fy}-04-01`; to = `${fy + 1}-03-31`;
    label = fyLabel(fy);
    prevQs = `period=year&fy=${fy - 1}`; nextQs = `period=year&fy=${fy + 1}`; nowQs = 'period=year';
  } else if (period === 'custom') {
    from = ISO.test(sp.from ?? '') ? sp.from! : `${today.slice(0, 7)}-01`;
    to = ISO.test(sp.to ?? '') ? sp.to! : today;
    if (to < from) [from, to] = [to, from];
    label = `${pretty(from)} – ${pretty(to)}`;
  } else {
    const wk = monday(ISO.test(sp.week ?? '') ? sp.week! : today);
    from = wk; to = addDays(wk, 6);
    label = `Week ${pretty(from)} – ${pretty(to)}`;
    prevQs = `period=week&week=${addDays(wk, -7)}`; nextQs = `period=week&week=${addDays(wk, 7)}`; nowQs = 'period=week';
  }

  const shed = sp.shed && /^\d+$/.test(sp.shed) ? Number(sp.shed) : null;
  const empFilter = sp.emp && /^\d+$/.test(sp.emp) ? Number(sp.emp) : null;
  const keep = `${shed !== null ? `&shed=${shed}` : ''}${empFilter !== null ? `&emp=${empFilter}` : ''}`;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb.rpc('fn_weaver_quality_wages', { p_from: from, p_to: to, p_shed: shed });
  const allRows = ((data ?? []) as Row[]);
  const rows = empFilter !== null ? allRows.filter((r) => Number(r.employee_id) === empFilter) : allRows;

  // Weaver list for the filter (everyone with production in the period).
  const weaverOpts = Array.from(new Map(allRows.map((r) => [Number(r.employee_id), r.full_name])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]));

  // ── Pivot ──
  interface Cell { metres: number; real: number; wage: number; minRate: number | null; maxRate: number | null; shifts: number }
  const qualities = Array.from(new Map(rows.map((r) => [r.quality_code, {
    code: r.quality_code, name: r.quality_name,
    folding: Number(r.count_unit_cm ?? 0) > 0 && Number(r.count_unit_cm) !== 100 ? Number(r.count_unit_cm) : null,
  }])).values()).sort((a, b) => a.code.localeCompare(b.code));

  interface Weaver { id: number; name: string; code: string; cells: Map<string, Cell>; wage: number }
  const weaverMap = new Map<number, Weaver>();
  for (const r of rows) {
    const id = Number(r.employee_id);
    let w = weaverMap.get(id);
    if (!w) { w = { id, name: r.full_name, code: r.emp_code ?? '', cells: new Map(), wage: 0 }; weaverMap.set(id, w); }
    const c: Cell = {
      metres: Number(r.metres), real: Number(r.real_metres), wage: Number(r.wage),
      minRate: r.min_rate == null ? null : Number(r.min_rate), maxRate: r.max_rate == null ? null : Number(r.max_rate),
      shifts: Number(r.shifts),
    };
    w.cells.set(r.quality_code, c);
    w.wage += c.wage;
  }
  const weavers = Array.from(weaverMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  const colWage = new Map<string, number>(); const colMetres = new Map<string, number>();
  for (const w of weavers) for (const [q, c] of w.cells) {
    colWage.set(q, (colWage.get(q) ?? 0) + c.wage);
    colMetres.set(q, (colMetres.get(q) ?? 0) + c.metres);
  }
  const grand = weavers.reduce((s, w) => s + w.wage, 0);

  function rateText(c: Cell): string {
    if (c.minRate == null) return '';
    return c.minRate === c.maxRate ? `@ ₹${c.minRate.toFixed(2)}` : `@ ₹${c.minRate.toFixed(2)}–${(c.maxRate ?? 0).toFixed(2)}`;
  }

  // ── Excel: one row per weaver x quality ──
  const exportColumns: ExcelColumn[] = [
    { key: 'weaver', label: 'Weaver', width: 22 },
    { key: 'code', label: 'Emp code', width: 11 },
    { key: 'quality', label: 'Quality', width: 12 },
    { key: 'quality_name', label: 'Quality name', width: 30 },
    { key: 'metres', label: 'Metres (as counted)', type: 'number', total: true },
    { key: 'unit', label: 'Unit', width: 16 },
    { key: 'real', label: 'Real metres', type: 'number', total: true },
    { key: 'rate', label: 'Rate / real m', type: 'rupee' },
    { key: 'wage', label: 'Wage', type: 'rupee', total: true },
  ];
  const qByCode = new Map(qualities.map((q) => [q.code, q]));
  const exportRows = weavers.flatMap((w) => Array.from(w.cells.entries()).map(([q, c]) => ({
    weaver: w.name, code: w.code, quality: q, quality_name: qByCode.get(q)?.name ?? q,
    metres: c.metres, unit: qByCode.get(q)?.folding ? `folding m (${qByCode.get(q)?.folding} cm)` : 'm',
    real: c.real, rate: c.minRate ?? 0, wage: c.wage,
  })));

  const tab = (p: Period, text: string) => (
    <Link href={`/app/reports/weaver-wages?period=${p}${keep}`}
      className={`px-3 py-1.5 rounded-md text-xs font-semibold border ${period === p ? 'bg-indigo text-white border-indigo' : 'bg-white border-line text-ink-soft hover:bg-haze/60'}`}>
      {text}
    </Link>
  );

  return (
    <div>
      <PageHeader
        title="Weaver Wages by Quality"
        subtitle={`${label}${shed !== null ? ` · Shed ${shed}` : ''}`}
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Weaver Wages' }]}
        actions={rows.length > 0 ? (
          <ExcelExportButton filename={`weaver-wages-${from}-to-${to}`} sheetName="Weaver wages"
            title={`Weaver Wages by Quality · ${label}`} columns={exportColumns} rows={exportRows} />
        ) : undefined}
      />

      {/* Period + filters */}
      <div className="card p-3 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {tab('week', 'Week')}{tab('month', 'Month')}{tab('year', 'Year (FY)')}{tab('custom', 'Custom')}
          {period !== 'custom' && (
            <div className="flex items-center gap-1 ml-2">
              <Link href={`/app/reports/weaver-wages?${prevQs}${keep}`} className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60">
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </Link>
              <Link href={`/app/reports/weaver-wages?${nowQs}${keep}`} className="rounded-md border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60">
                {period === 'week' ? 'This week' : period === 'month' ? 'This month' : 'This year'}
              </Link>
              <Link href={`/app/reports/weaver-wages?${nextQs}${keep}`} className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60">
                Next <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>
        <form action="/app/reports/weaver-wages" method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="period" value={period} />
          {period === 'week' && (
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Any day in week
              <input name="week" type="date" defaultValue={from} className="input py-1 text-xs" />
            </label>
          )}
          {period === 'month' && (
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Month
              <input name="month" type="month" defaultValue={from.slice(0, 7)} className="input py-1 text-xs" />
            </label>
          )}
          {period === 'year' && (
            <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Financial year
              <select name="fy" defaultValue={String(fyOf(from))} className="input py-1 text-xs">
                {Array.from({ length: 6 }, (_, i) => fyOf(today) - i).map((y) => <option key={y} value={y}>{fyLabel(y)}</option>)}
              </select>
            </label>
          )}
          {period === 'custom' && (
            <>
              <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">From
                <input name="from" type="date" defaultValue={from} className="input py-1 text-xs" />
              </label>
              <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">To
                <input name="to" type="date" defaultValue={to} className="input py-1 text-xs" />
              </label>
            </>
          )}
          <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Shed
            <select name="shed" defaultValue={shed !== null ? String(shed) : ''} className="input py-1 text-xs">
              <option value="">All sheds</option>
              {SHEDS.map((s) => <option key={s} value={s}>Shed {s}</option>)}
            </select>
          </label>
          <label className="flex flex-col text-[10px] uppercase tracking-wide text-ink-mute">Weaver
            <select name="emp" defaultValue={empFilter !== null ? String(empFilter) : ''} className="input py-1 text-xs min-w-[160px]">
              <option value="">All weavers</option>
              {weaverOpts.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
          <button type="submit" className="btn-primary text-xs py-1.5">Apply</button>
        </form>
      </div>

      {error && <div className="card p-3 mb-4 text-err text-sm">Could not load: {error.message}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3"><div className="text-xs text-ink-mute">Weavers</div><div className="text-lg font-semibold mt-1">{weavers.length}</div></div>
        <div className="card p-3"><div className="text-xs text-ink-mute">Qualities</div><div className="text-lg font-semibold mt-1">{qualities.length}</div></div>
        <div className="card p-3 col-span-2"><div className="text-xs text-ink-mute">Total weaving wages</div><div className="text-lg font-semibold mt-1 num">{rupee(grand)}</div></div>
      </div>

      {weavers.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">No shift-log production in this period.</div>
      ) : (
        <>
          {/* Desktop pivot */}
          <div className="card overflow-x-auto mb-6 hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-4 py-3 sticky left-0 bg-cloud/60 min-w-[170px]">Weaver</th>
                  {qualities.map((q) => (
                    <th key={q.code} className="text-right px-3 py-3 whitespace-nowrap" title={q.name}>
                      {q.code === 'NO_QUALITY' ? 'No quality' : q.code}
                      <div className="text-[9px] normal-case tracking-normal font-normal text-ink-mute max-w-[140px] truncate ml-auto">{q.name}</div>
                      {q.folding && <div className="text-[9px] normal-case tracking-normal text-amber-700">folding m</div>}
                    </th>
                  ))}
                  <th className="text-right px-4 py-3 font-bold">Total wage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {weavers.map((w) => (
                  <tr key={w.id} className="hover:bg-haze/40 align-top">
                    <td className="px-4 py-2.5 sticky left-0 bg-white">
                      <div className="font-medium">{w.name}</div>
                      <div className="text-[11px] text-ink-mute">{w.code}</div>
                    </td>
                    {qualities.map((q) => {
                      const c = w.cells.get(q.code);
                      return (
                        <td key={q.code} className="px-3 py-2.5 text-right">
                          {c ? (
                            <>
                              <div className="num font-semibold">{rupee(c.wage)}</div>
                              <div className="text-[11px] text-ink-mute num whitespace-nowrap">{num(c.metres)} {q.folding ? 'fold m' : 'm'} {rateText(c)}</div>
                            </>
                          ) : <span className="text-ink-mute/40">{'—'}</span>}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5 text-right num font-bold">{rupee(w.wage)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line bg-cloud/30 text-xs font-semibold">
                <tr className="align-top">
                  <td className="px-4 py-2.5 sticky left-0 bg-cloud/30 uppercase tracking-wide text-ink-soft">Total</td>
                  {qualities.map((q) => (
                    <td key={q.code} className="px-3 py-2.5 text-right">
                      <div className="num">{rupee(colWage.get(q.code) ?? 0)}</div>
                      <div className="text-[11px] text-ink-mute num font-normal">{num(colMetres.get(q.code) ?? 0)} {q.folding ? 'fold m' : 'm'}</div>
                    </td>
                  ))}
                  <td className="px-4 py-2.5 text-right num font-bold text-ink">{rupee(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden space-y-3 mb-6">
            {weavers.map((w) => (
              <div key={w.id} className="card p-3">
                <div className="flex justify-between items-baseline mb-2">
                  <div><div className="font-semibold">{w.name}</div><div className="text-[11px] text-ink-mute">{w.code}</div></div>
                  <div className="num font-bold">{rupee(w.wage)}</div>
                </div>
                <div className="space-y-1">
                  {qualities.filter((q) => w.cells.has(q.code)).map((q) => {
                    const c = w.cells.get(q.code)!;
                    return (
                      <div key={q.code} className="flex justify-between text-xs">
                        <span className="text-ink-soft">{q.name}<span className="text-ink-mute"> · {num(c.metres)} {q.folding ? 'fold m' : 'm'} {rateText(c)}</span></span>
                        <span className="num font-semibold">{rupee(c.wage)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-ink-mute">
            Wage = real metres × the rate saved on each shift log (the loom/quality rate on that day). Society saree metres are shown in folding metres
            (1 = 137 cm) as typed; the wage uses the real metres, i.e. ₹12 per 5.5 m saree. Adjustments are not a weaver&apos;s wage and are excluded.
          </p>
        </>
      )}
    </div>
  );
}
