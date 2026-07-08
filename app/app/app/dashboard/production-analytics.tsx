'use client';

/**
 * Production Analytics — dashboard graphs for loom utilisation, daily
 * production and top weavers, driven by the production shift log.
 * Period is selectable: last 7 days, last 30 days, or this month.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Loader2, TrendingUp } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

type Period = '7d' | '30d' | 'month';

interface ShiftLogRow {
  id: number;
  log_date: string;
  loom_id: number;
  adjustment_metres: number | string | null;
}

interface WeaverLogRow {
  shift_log_id: number;
  employee_id: number;
  metres_woven: number | string | null;
  shift_log: { log_date: string } | null;
}

interface LoomRow {
  id: number;
  status: string;
  shed_no: number | null;
}

interface ShedPoint {
  name: string;
  utilisation: number; // avg % over working days
  avgLooms: number;
  runnable: number;
  metres: number;
}

interface DayPoint {
  date: string;      // ISO yyyy-mm-dd
  label: string;     // dd/mm for the axis
  metres: number;
  looms: number;     // distinct looms that logged this day
  utilisation: number; // 0-100 %
}

interface WeaverPoint {
  name: string;
  metres: number;
}

const PERIODS: Array<{ key: Period; label: string }> = [
  { key: '7d',    label: '7 days' },
  { key: '30d',   label: '30 days' },
  { key: 'month', label: 'This month' },
];

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function periodStart(p: Period): string {
  if (p === '7d') return isoDaysAgo(6);
  if (p === '30d') return isoDaysAgo(29);
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Every ISO date from `from` to today inclusive, so days with no
 *  production still appear as gaps in the charts. */
function dateRange(from: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  while (d.getTime() <= today.getTime()) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function shortLabel(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** PostgREST caps each response (~1000 rows), so page until a short
 *  page comes back. Keeps the charts correct as the log grows. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let i = 0; ; i += page) {
    const { data, error } = await build(i, i + page - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

const INDIGO  = '#4f46e5';
const EMERALD = '#10b981';
const AMBER   = '#f59e0b';

interface TooltipEntry { value?: number | string; payload?: DayPoint | ShedPoint | WeaverPoint }

/** Shared tooltip card so all three charts speak one visual language. */
function ChartTip({
  active, payload, label, formatter,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  formatter: (entry: TooltipEntry) => string;
}) {
  const first = payload?.[0];
  if (!active || !first) return null;
  return (
    <div className="rounded-lg border border-line/60 bg-paper px-3 py-2 shadow-lg text-xs">
      <div className="font-semibold text-ink mb-0.5">{label}</div>
      <div className="text-ink-soft">{formatter(first)}</div>
    </div>
  );
}

export function ProductionAnalytics(): React.ReactElement {
  const supabase = createClient();
  const [period, setPeriod] = useState<Period>('30d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shiftLogs, setShiftLogs] = useState<ShiftLogRow[]>([]);
  const [weaverLogs, setWeaverLogs] = useState<WeaverLogRow[]>([]);
  const [looms, setLooms] = useState<LoomRow[]>([]);
  const [employeeNames, setEmployeeNames] = useState<Map<number, string>>(new Map());

  const load = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    const from = periodStart(p);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    try {
      const [logs, weavers, loomsRes, employeesRes] = await Promise.all([
        fetchAll<ShiftLogRow>((a, b) =>
          sb.from('production_shift_log')
            .select('id, log_date, loom_id, adjustment_metres')
            .gte('log_date', from)
            .order('id')
            .range(a, b)),
        fetchAll<WeaverLogRow>((a, b) =>
          sb.from('production_shift_log_weaver')
            .select('shift_log_id, employee_id, metres_woven, shift_log:shift_log_id!inner(log_date)')
            .gte('shift_log.log_date', from)
            .order('id')
            .range(a, b)),
        sb.from('loom').select('id, status, shed_no'),
        sb.from('employee').select('id, full_name'),
      ]);
      setShiftLogs(logs);
      setWeaverLogs(weavers);
      setLooms((loomsRes.data ?? []) as LoomRow[]);
      setEmployeeNames(new Map(
        ((employeesRes.data ?? []) as Array<{ id: number; full_name: string }>).map((e) => [e.id, e.full_name]),
      ));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load analytics');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { void load(period); }, [load, period]);

  // Utilisation denominator: every loom that could have run — looms
  // parked in maintenance are excluded.
  const loomDenominator = useMemo(
    () => looms.filter((l) => l.status !== 'maintenance').length,
    [looms],
  );

  const days: DayPoint[] = useMemo(() => {
    const metresByDay = new Map<string, number>();
    for (const w of weaverLogs) {
      const d = w.shift_log?.log_date;
      if (!d) continue;
      metresByDay.set(d, (metresByDay.get(d) ?? 0) + Number(w.metres_woven ?? 0));
    }
    const loomsByDay = new Map<string, Set<number>>();
    for (const l of shiftLogs) {
      let set = loomsByDay.get(l.log_date);
      if (!set) { set = new Set(); loomsByDay.set(l.log_date, set); }
      set.add(l.loom_id);
      const adj = Number(l.adjustment_metres ?? 0);
      if (adj !== 0) metresByDay.set(l.log_date, (metresByDay.get(l.log_date) ?? 0) + adj);
    }
    return dateRange(periodStart(period)).map((date) => {
      const looms = loomsByDay.get(date)?.size ?? 0;
      return {
        date,
        label: shortLabel(date),
        metres: Math.round(metresByDay.get(date) ?? 0),
        looms,
        utilisation: loomDenominator > 0 ? Math.round((looms / loomDenominator) * 100) : 0,
      };
    });
  }, [shiftLogs, weaverLogs, loomDenominator, period]);

  const topWeavers: WeaverPoint[] = useMemo(() => {
    const byEmployee = new Map<number, number>();
    for (const w of weaverLogs) {
      byEmployee.set(w.employee_id, (byEmployee.get(w.employee_id) ?? 0) + Number(w.metres_woven ?? 0));
    }
    return Array.from(byEmployee.entries())
      .map(([id, metres]) => ({ name: employeeNames.get(id) ?? `#${id}`, metres: Math.round(metres) }))
      .sort((a, b) => b.metres - a.metres)
      .slice(0, 10);
  }, [weaverLogs, employeeNames]);

  const sheds: ShedPoint[] = useMemo(() => {
    const shedByLoom = new Map<number, number>();
    const runnableByShed = new Map<number, number>();
    for (const l of looms) {
      if (l.shed_no == null) continue;
      shedByLoom.set(l.id, l.shed_no);
      if (l.status !== 'maintenance') {
        runnableByShed.set(l.shed_no, (runnableByShed.get(l.shed_no) ?? 0) + 1);
      }
    }
    // Which shed each shift log belongs to, so weaver metres and the
    // per-day loom counts can be bucketed by shed.
    const shedByShiftLog = new Map<number, number>();
    const loomsByDayShed = new Map<string, Set<number>>(); // "date|shed" → loom ids
    const workingDays = new Set<string>();
    for (const l of shiftLogs) {
      const shed = shedByLoom.get(l.loom_id);
      if (shed == null) continue;
      shedByShiftLog.set(l.id, shed);
      workingDays.add(l.log_date);
      const key = `${l.log_date}|${shed}`;
      let set = loomsByDayShed.get(key);
      if (!set) { set = new Set(); loomsByDayShed.set(key, set); }
      set.add(l.loom_id);
    }
    const metresByShed = new Map<number, number>();
    for (const w of weaverLogs) {
      const shed = shedByShiftLog.get(w.shift_log_id);
      if (shed == null) continue;
      metresByShed.set(shed, (metresByShed.get(shed) ?? 0) + Number(w.metres_woven ?? 0));
    }
    const shedNos = Array.from(runnableByShed.keys()).sort((a, b) => a - b);
    const dayCount = workingDays.size;
    return shedNos.map((shed) => {
      const runnable = runnableByShed.get(shed) ?? 0;
      let ranTotal = 0;
      for (const d of workingDays) ranTotal += loomsByDayShed.get(`${d}|${shed}`)?.size ?? 0;
      const avgLooms = dayCount > 0 ? ranTotal / dayCount : 0;
      return {
        name: `Shed ${shed}`,
        utilisation: runnable > 0 ? Math.round((avgLooms / runnable) * 100) : 0,
        avgLooms: Math.round(avgLooms * 10) / 10,
        runnable,
        metres: Math.round(metresByShed.get(shed) ?? 0),
      };
    });
  }, [looms, shiftLogs, weaverLogs]);

  const totalMetres = useMemo(() => days.reduce((s, d) => s + d.metres, 0), [days]);
  const daysWithProduction = useMemo(() => days.filter((d) => d.metres > 0).length, [days]);
  const avgPerDay = daysWithProduction > 0 ? Math.round(totalMetres / daysWithProduction) : 0;
  const bestDay = useMemo(
    () => days.reduce<DayPoint | null>((best, d) => (d.metres > (best?.metres ?? 0) ? d : best), null),
    [days],
  );
  const avgUtilisation = daysWithProduction > 0
    ? Math.round(days.filter((d) => d.looms > 0).reduce((s, d) => s + d.utilisation, 0) / daysWithProduction)
    : 0;

  return (
    <section className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-indigo" />
          <h2 className="font-display font-bold text-base">Production Analytics</h2>
        </div>
        <div className="flex rounded-lg border border-line/60 overflow-hidden text-xs font-semibold">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                'px-3 py-1.5 transition ' +
                (period === p.key ? 'bg-indigo text-white' : 'bg-paper text-ink-soft hover:bg-haze')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-err text-xs mb-3">Could not load analytics: {error}</div>}

      {loading ? (
        <div className="h-48 grid place-items-center text-ink-mute">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="rounded-xl bg-indigo-50/70 p-3">
              <div className="num text-lg font-bold text-indigo-700 leading-tight">{totalMetres.toLocaleString('en-IN')} m</div>
              <div className="text-[11px] text-ink-soft uppercase tracking-wide">Total production</div>
            </div>
            <div className="rounded-xl bg-emerald-50/70 p-3">
              <div className="num text-lg font-bold text-emerald-700 leading-tight">{avgUtilisation}%</div>
              <div className="text-[11px] text-ink-soft uppercase tracking-wide">Avg loom utilisation</div>
            </div>
            <div className="rounded-xl bg-amber-50/70 p-3">
              <div className="num text-lg font-bold text-amber-700 leading-tight">{avgPerDay.toLocaleString('en-IN')} m</div>
              <div className="text-[11px] text-ink-soft uppercase tracking-wide">Avg per working day</div>
            </div>
            <div className="rounded-xl bg-rose-50/70 p-3">
              <div className="num text-lg font-bold text-rose-700 leading-tight">
                {bestDay && bestDay.metres > 0 ? `${bestDay.metres.toLocaleString('en-IN')} m` : '—'}
              </div>
              <div className="text-[11px] text-ink-soft uppercase tracking-wide">
                Best day{bestDay && bestDay.metres > 0 ? ` · ${bestDay.label}` : ''}
              </div>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* Daily production */}
            <div>
              <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Daily production (m)</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={days} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradProd" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={INDIGO} stopOpacity={0.95} />
                        <stop offset="100%" stopColor={INDIGO} stopOpacity={0.55} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(79,70,229,0.06)' }}
                      content={<ChartTip formatter={(e) => `${Number(e.value ?? 0).toLocaleString('en-IN')} m woven`} />}
                    />
                    <Bar dataKey="metres" fill="url(#gradProd)" radius={[5, 5, 0, 0]} maxBarSize={26} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Loom utilisation */}
            <div>
              <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">
                Loom utilisation (% of {loomDenominator} looms)
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={days} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradUtil" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={EMERALD} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={EMERALD} stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ stroke: EMERALD, strokeDasharray: '3 3' }}
                      content={<ChartTip formatter={(e) => `${e.value}% — ${(e.payload as DayPoint | undefined)?.looms ?? 0} of ${loomDenominator} looms ran`} />}
                    />
                    <Area type="monotone" dataKey="utilisation" stroke={EMERALD} strokeWidth={2.5} fill="url(#gradUtil)" dot={false} activeDot={{ r: 4 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Shed-wise utilisation */}
            <div>
              <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Shed-wise utilisation (avg %)</h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sheds} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(139,92,246,0.08)' }}
                      content={
                        <ChartTip
                          formatter={(e) => {
                            const p = e.payload as ShedPoint | undefined;
                            return `${e.value}% — avg ${p?.avgLooms ?? 0} of ${p?.runnable ?? 0} looms · ${(p?.metres ?? 0).toLocaleString('en-IN')} m`;
                          }}
                        />
                      }
                    />
                    <Bar dataKey="utilisation" radius={[5, 5, 0, 0]} maxBarSize={44} label={{ position: 'top', fontSize: 10, formatter: (v: number) => `${v}%` }}>
                      {sheds.map((s, i) => (
                        <Cell key={s.name} fill="#8b5cf6" fillOpacity={1 - i * 0.15} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Top weavers */}
            <div>
              <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide mb-2">Top weavers (m woven)</h3>
            {topWeavers.length === 0 ? (
              <p className="text-xs text-ink-mute">No weaver shift logs in this period.</p>
            ) : (
              <div style={{ height: Math.max(120, topWeavers.length * 30) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topWeavers} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <Tooltip
                      cursor={{ fill: 'rgba(245,158,11,0.08)' }}
                      content={<ChartTip formatter={(e) => `${Number(e.value ?? 0).toLocaleString('en-IN')} m in this period`} />}
                    />
                    <Bar dataKey="metres" radius={[0, 5, 5, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 10, formatter: (v: number) => v.toLocaleString('en-IN') }}>
                      {topWeavers.map((w, i) => (
                        <Cell key={w.name} fill={i === 0 ? AMBER : '#fbbf24'} fillOpacity={1 - i * 0.06} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
