/**
 * Shed Running Report
 *
 * Which sheds were actually running each shift over a chosen period.
 *
 * Period inputs:
 *   ?view = 'week' | 'month' | 'year'   (default 'week')
 *   ?from = ISO date — start of the period
 *
 * A shift slot (date, shift) is:
 *   - 'running'  if at least one WEAVER has an attendance_entry whose
 *                shed_no (or shed_nos[]) covers the shed for that slot
 *                and whose status is one of present / half_day / late /
 *                early_leave.
 *   - 'holiday'  if the slot has an attendance_day row with
 *                is_working = false (covers all sheds for that slot).
 *   - 'idle'     otherwise.
 *
 * Winders' shed picks are deliberately ignored here — the question
 * "did the loom-shed actually run?" is answered by weaver presence.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Activity, ChevronLeft, ChevronRight, CalendarOff } from 'lucide-react';

export const metadata = { title: 'Shed Running' };
export const dynamic = 'force-dynamic';

type View = 'week' | 'month' | 'year';
type Shift = 'morning' | 'night';
type CellStatus = 'running' | 'idle' | 'holiday';

const SHEDS = ['1', '2', '3', '4'] as const;
const SHIFTS: readonly Shift[] = ['morning', 'night'] as const;

const PRESENT_EFFECTIVE = new Set<string>([
  'present',
  'half_day',
  'late',
  'early_leave',
]);

interface AttendanceEntryRow {
  status: string | null;
  shed_no: string | null;
  shed_nos: string[] | null;
  employee: { role: string | null } | null;
  attendance_day: {
    attendance_date: string | null;
    shift: string | null;
    is_working: boolean | null;
  } | null;
}

interface HolidayRow {
  attendance_date: string | null;
  shift: string | null;
}

// ---------- date helpers ----------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseISO(s: string): Date {
  // Construct as local date to avoid TZ drift on date-only strings.
  const parts = s.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(y, (m || 1) - 1, d || 1);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0=Sun .. 6=Sat
  const diff = (day + 6) % 7; // days since Monday
  return addDays(d, -diff);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfFY(d: Date): Date {
  // Indian FY: April 1 → March 31. If current month < April use previous year.
  const y = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
  return new Date(y, 3, 1);
}

function endOfFY(d: Date): Date {
  const start = startOfFY(d);
  return new Date(start.getFullYear() + 1, 2, 31);
}

function rangeFor(view: View, from: Date): { start: Date; end: Date } {
  if (view === 'week') {
    const start = startOfWeekMonday(from);
    return { start, end: addDays(start, 6) };
  }
  if (view === 'month') {
    return { start: startOfMonth(from), end: endOfMonth(from) };
  }
  return { start: startOfFY(from), end: endOfFY(from) };
}

function eachDay(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cur = start;
  while (cur.getTime() <= end.getTime()) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function fmtWeekdayDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit' });
}

function today(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// ---------- page ----------

export default async function ShedRunningReport({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; from?: string }>;
}) {
  const sp = await searchParams;
  const view: View =
    sp.view === 'month' || sp.view === 'year' ? sp.view : 'week';

  const fromInput =
    sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? parseISO(sp.from) : today();
  const { start, end } = rangeFor(view, fromInput);
  const startISO = toISO(start);
  const endISO = toISO(end);

  const supabase = await createClient();

  // 1) Attendance entries for the period from weavers, filtered to
  //    present-effective statuses. We join attendance_day for the date/shift
  //    and employee for the role. supabase-js types lag — cast through any.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: entryData, error: entryErr } = await (supabase as any)
    .from('attendance_entry')
    .select(
      'status, shed_no, shed_nos, employee:employee_id ( role ), attendance_day:attendance_day_id ( attendance_date, shift, is_working )',
    )
    .gte('attendance_day.attendance_date', startISO)
    .lte('attendance_day.attendance_date', endISO);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // 2) Holidays = attendance_day with is_working = false in range.
  const { data: holidayData, error: holidayErr } = await supabase
    .from('attendance_day')
    .select('attendance_date, shift, is_working')
    .gte('attendance_date', startISO)
    .lte('attendance_date', endISO)
    .eq('is_working', false);

  const error = entryErr ?? holidayErr;

  const allEntries = (entryData as unknown as AttendanceEntryRow[]) ?? [];
  // The nested filter on attendance_day.attendance_date acts as a join filter
  // in PostgREST but may still return rows where attendance_day is null when
  // the FK row is outside the period. Drop those.
  const entries = allEntries.filter((r) => r.attendance_day != null);

  const holidays = (holidayData as unknown as HolidayRow[]) ?? [];

  // ---------- compute cell status map ----------

  // key = `${date}|${shift}|${shed}`
  const running = new Set<string>();
  for (const r of entries) {
    const day = r.attendance_day;
    if (!day) continue;
    const date = day.attendance_date;
    const shift = day.shift;
    const isWorking = day.is_working;
    if (!date || !shift) continue;
    if (isWorking === false) continue; // holiday slot — not "running"
    const role = (r.employee?.role ?? '').toLowerCase();
    if (role !== 'weaver') continue;
    const status = (r.status ?? '').toLowerCase();
    if (!PRESENT_EFFECTIVE.has(status)) continue;
    const sheds = new Set<string>();
    if (Array.isArray(r.shed_nos)) {
      for (const s of r.shed_nos) {
        if (typeof s === 'string' && s) sheds.add(s);
      }
    }
    if (r.shed_no) sheds.add(r.shed_no);
    for (const s of sheds) {
      running.add(`${date}|${shift}|${s}`);
    }
  }

  const holidaySlots = new Set<string>();
  for (const h of holidays) {
    if (!h.attendance_date || !h.shift) continue;
    holidaySlots.add(`${h.attendance_date}|${h.shift}`);
  }

  // TODO: if a dedicated `holiday` master table is added later (covering
  // company-wide holidays not tied to attendance_day), merge those slots
  // into holidaySlots here.

  function cellStatus(date: string, shift: Shift, shed: string): CellStatus {
    if (running.has(`${date}|${shift}|${shed}`)) return 'running';
    if (holidaySlots.has(`${date}|${shift}`)) return 'holiday';
    return 'idle';
  }

  // ---------- build slot list ----------

  const days = eachDay(start, end);

  // Per-shed summary counts across the whole period.
  interface ShedSummary {
    running: number;
    idle: number;
    holiday: number;
    total: number;
  }
  const summary: Record<string, ShedSummary> = {};
  for (const shed of SHEDS) {
    summary[shed] = { running: 0, idle: 0, holiday: 0, total: 0 };
  }
  for (const d of days) {
    const iso = toISO(d);
    for (const sh of SHIFTS) {
      for (const shed of SHEDS) {
        const cur = summary[shed];
        if (!cur) continue;
        cur.total += 1;
        const st = cellStatus(iso, sh, shed);
        if (st === 'running') cur.running += 1;
        else if (st === 'holiday') cur.holiday += 1;
        else cur.idle += 1;
      }
    }
  }

  // ---------- navigation helpers ----------

  function shiftPeriod(direction: -1 | 0 | 1): string {
    if (direction === 0) return toISO(today());
    if (view === 'week') {
      return toISO(addDays(start, direction * 7));
    }
    if (view === 'month') {
      const m = new Date(start.getFullYear(), start.getMonth() + direction, 1);
      return toISO(m);
    }
    const y = new Date(start.getFullYear() + direction, 3, 1);
    return toISO(y);
  }

  function linkFor(v: View, isoFrom: string): string {
    return `/app/reports/shed-running?view=${v}&from=${isoFrom}`;
  }

  const periodLabel = (() => {
    if (view === 'week') {
      return `${fmtShort(start)} — ${fmtShort(end)} ${end.getFullYear()}`;
    }
    if (view === 'month') {
      return start.toLocaleDateString('en-IN', {
        month: 'long',
        year: 'numeric',
      });
    }
    return `FY ${start.getFullYear()}-${String(end.getFullYear()).slice(-2)}`;
  })();

  return (
    <div>
      <PageHeader
        title="Shed Running"
        subtitle="Did each shed actually run this shift? Green = a weaver was present, red = idle, gray = holiday."
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Shed Running' }]}
      />

      {/* View tabs */}
      <div className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {(['week', 'month', 'year'] as View[]).map((v) => (
            <Link
              key={v}
              href={linkFor(v, toISO(start))}
              className={
                'min-h-[40px] rounded-md px-3 py-2 text-sm font-semibold capitalize transition ' +
                (view === v
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-ink-soft border border-line hover:bg-haze/60')
              }
            >
              {v}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <Link
            href={linkFor(view, shiftPeriod(-1))}
            aria-label="Previous period"
            className="min-h-[40px] flex items-center justify-center rounded-md border border-line bg-white px-2 hover:bg-haze/60"
          >
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link
            href={linkFor(view, shiftPeriod(0))}
            className="min-h-[40px] rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-haze/60"
          >
            Today
          </Link>
          <Link
            href={linkFor(view, shiftPeriod(1))}
            aria-label="Next period"
            className="min-h-[40px] flex items-center justify-center rounded-md border border-line bg-white px-2 hover:bg-haze/60"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

        <form method="GET" className="flex items-end gap-2">
          <input type="hidden" name="view" value={view} />
          <div>
            <label className="label" htmlFor="from">
              Jump to
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={toISO(start)}
              className="input"
            />
          </div>
          <button type="submit" className="btn-primary min-h-[40px]">
            Go
          </button>
        </form>

        <div className="ml-auto text-sm text-ink-mute">
          <Activity className="inline-block h-4 w-4 mr-1 align-text-bottom" />
          {periodLabel}
        </div>
      </div>

      {error && (
        <div className="card p-4 mb-4 text-sm text-err">
          Could not load shed running data: {error.message}
        </div>
      )}

      {/* Per-shed summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {SHEDS.map((shed) => {
          const s = summary[shed] ?? { running: 0, idle: 0, holiday: 0, total: 0 };
          const uptime =
            s.total > 0 ? ((s.running + s.holiday) / s.total) * 100 : 0;
          return (
            <div key={shed} className="card p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Shed {shed}</h3>
                <span className="text-xs text-ink-mute">
                  {s.total} shift{s.total === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-2 text-2xl font-semibold num">
                {uptime.toFixed(1)}%
              </div>
              <div className="text-xs text-ink-mute">% uptime (running + holiday)</div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                  Running {s.running}
                </span>
                <span className="rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                  Idle {s.idle}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-ink-soft">
                  <CalendarOff className="inline-block h-3 w-3 mr-0.5 align-text-bottom" />
                  Holiday {s.holiday}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Pivot grid */}
      {view === 'year' ? (
        <YearPivot
          days={days}
          shedFor={(iso, sh, shed) => cellStatus(iso, sh, shed)}
        />
      ) : (
        <ShiftPivot
          days={days}
          shedFor={(iso, sh, shed) => cellStatus(iso, sh, shed)}
        />
      )}
    </div>
  );
}

// ---------- pivot components ----------

interface PivotProps {
  days: Date[];
  shedFor: (iso: string, shift: Shift, shed: string) => CellStatus;
}

function cellColor(st: CellStatus): string {
  if (st === 'running') return 'bg-emerald-500';
  if (st === 'idle') return 'bg-rose-400';
  return 'bg-slate-300';
}

function cellLabel(st: CellStatus): string {
  if (st === 'running') return 'Running';
  if (st === 'idle') return 'Idle';
  return 'Holiday';
}

function ShiftPivot({ days, shedFor }: PivotProps) {
  // Columns = each (date, shift) slot. Two columns per day.
  return (
    <div className="card p-3 overflow-x-auto">
      <table className="text-xs border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white text-left pr-3 py-1 font-semibold">
              Shed
            </th>
            {days.map((d) => {
              const iso = toISO(d);
              return (
                <th
                  key={iso}
                  colSpan={2}
                  className="px-1 py-1 text-center font-semibold text-ink-mute whitespace-nowrap border-l border-line/40"
                >
                  {fmtWeekdayDate(d)}
                </th>
              );
            })}
          </tr>
          <tr>
            <th className="sticky left-0 z-10 bg-white" />
            {days.flatMap((d) => {
              const iso = toISO(d);
              return SHIFTS.map((s) => (
                <th
                  key={`${iso}-${s}`}
                  className="px-1 py-0.5 text-center font-medium text-ink-mute whitespace-nowrap"
                >
                  {s === 'morning' ? 'M' : 'N'}
                </th>
              ));
            })}
          </tr>
        </thead>
        <tbody>
          {SHEDS.map((shed) => (
            <tr key={shed}>
              <td className="sticky left-0 z-10 bg-white pr-3 py-1 font-semibold whitespace-nowrap">
                Shed {shed}
              </td>
              {days.flatMap((d) => {
                const iso = toISO(d);
                return SHIFTS.map((sh) => {
                  const st = shedFor(iso, sh, shed);
                  return (
                    <td key={`${iso}-${sh}-${shed}`} className="p-0">
                      <div
                        title={`${fmtWeekdayDate(d)} ${sh} — ${cellLabel(st)}`}
                        className={
                          'h-6 w-6 rounded-sm ' + cellColor(st)
                        }
                      />
                    </td>
                  );
                });
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function YearPivot({ days, shedFor }: PivotProps) {
  // ~365 days × 2 shifts = ~730 cells per shed. We aggregate by ISO week:
  // one cell per (shed, week) showing the majority status across the 14
  // shift-slots that fall in that week.
  interface WeekBucket {
    start: Date;
    keys: string[]; // for tooltip
    counts: { running: number; idle: number; holiday: number };
  }

  // Group days into ISO weeks (Mon-Sun).
  const buckets: WeekBucket[] = [];
  if (days.length > 0) {
    const first = days[0];
    if (first) {
      let weekStart = startOfWeekMonday(first);
      let cur: WeekBucket = {
        start: weekStart,
        keys: [],
        counts: { running: 0, idle: 0, holiday: 0 },
      };
      buckets.push(cur);
      for (const d of days) {
        const ws = startOfWeekMonday(d);
        if (ws.getTime() !== weekStart.getTime()) {
          weekStart = ws;
          cur = {
            start: weekStart,
            keys: [],
            counts: { running: 0, idle: 0, holiday: 0 },
          };
          buckets.push(cur);
        }
        cur.keys.push(toISO(d));
      }
    }
  }

  function majorityForShed(b: WeekBucket, shed: string): CellStatus {
    let r = 0;
    let i = 0;
    let h = 0;
    for (const iso of b.keys) {
      for (const sh of SHIFTS) {
        const st = shedFor(iso, sh, shed);
        if (st === 'running') r += 1;
        else if (st === 'idle') i += 1;
        else h += 1;
      }
    }
    if (r >= i && r >= h) return 'running';
    if (h >= i) return 'holiday';
    return 'idle';
  }

  return (
    <div className="card p-3 overflow-x-auto">
      <p className="text-xs text-ink-mute mb-2">
        Year view aggregates by ISO week — each cell = one week, colour = majority status across the 14 shift-slots in that week.
      </p>
      <table className="text-xs border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-white text-left pr-3 py-1 font-semibold">
              Shed
            </th>
            {buckets.map((b) => (
              <th
                key={toISO(b.start)}
                className="px-1 py-1 text-center font-semibold text-ink-mute whitespace-nowrap"
              >
                {fmtShort(b.start)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SHEDS.map((shed) => (
            <tr key={shed}>
              <td className="sticky left-0 z-10 bg-white pr-3 py-1 font-semibold whitespace-nowrap">
                Shed {shed}
              </td>
              {buckets.map((b) => {
                const st = majorityForShed(b, shed);
                return (
                  <td key={toISO(b.start) + shed} className="p-0">
                    <div
                      title={`Week of ${fmtShort(b.start)} — ${cellLabel(st)} (majority)`}
                      className={'h-5 w-5 rounded-sm ' + cellColor(st)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
