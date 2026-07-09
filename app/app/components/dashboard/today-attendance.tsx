/**
 * Today's Attendance widget (CORR-A6)
 *
 * Server component for the dashboard. One read against
 * v_today_attendance_widget gives us per-role × per-shift present counts,
 * the active head-count denominator, and the holiday flag (if any). We
 * group those rows into a Morning + Night two-column layout, with a red
 * banner per shift that is flagged non-working.
 */
import Link from 'next/link';
import { CalendarOff, ClipboardCheck, ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

type Shift = 'morning' | 'night';

interface WidgetRow {
  shift: Shift | null;
  employee_role: string | null;
  headcount: number | null;
  present_count: number | null;
  is_working: boolean | null;
  reason: string | null;
  remark: string | null;
  attendance_date: string | null;
}

interface ShiftSection {
  shift: Shift;
  isWorking: boolean;
  reason: string | null;
  remark: string | null;
  roles: ReadonlyArray<{
    role: string;
    headcount: number;
    presentCount: number;
  }>;
  totalHeadcount: number;
  totalPresent: number;
  weaverSheds: ReadonlyArray<{ shed: string; names: string[] }>;
}

/** One present-today attendance row for a weaver, with the shed(s)
 *  they were marked into and the shift it belongs to. */
interface WeaverEntryRow {
  status: string;
  shed_no: string | null;
  shed_nos: string[] | null;
  day: { shift: Shift; attendance_date: string } | null;
  employee: { full_name: string; role: string; home_shed_no: string | null } | null;
}

const REASON_LABEL: Record<string, string> = {
  power_cut: 'Power cut',
  national_holiday: 'National holiday',
  maintenance: 'Maintenance',
  other: 'Other',
};

const SHIFT_LABEL: Record<Shift, string> = {
  morning: 'Morning (8 AM – 8 PM)',
  night: 'Night (8 PM – 8 AM)',
};

function fmtToday(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Group today's present weavers by shed for one shift. A weaver
 *  marked into two sheds appears under both. Shed order 1→4; anyone
 *  without a shed lands in "—" at the end. */
function buildWeaverSheds(
  weaverRows: ReadonlyArray<WeaverEntryRow>,
  shift: Shift,
): Array<{ shed: string; names: string[] }> {
  const byShed = new Map<string, Set<string>>();
  for (const w of weaverRows) {
    if (w.day?.shift !== shift) continue;
    const name = w.employee?.full_name?.trim();
    if (!name) continue;
    const sheds = (w.shed_nos && w.shed_nos.length > 0)
      ? w.shed_nos
      : (w.shed_no ? [w.shed_no] : (w.employee?.home_shed_no ? [w.employee.home_shed_no] : ['—']));
    for (const shed of sheds) {
      const set = byShed.get(shed) ?? new Set<string>();
      set.add(name);
      byShed.set(shed, set);
    }
  }
  return Array.from(byShed.entries())
    .map(([shed, names]) => ({ shed, names: Array.from(names).sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => {
      if (a.shed === '—') return 1;
      if (b.shed === '—') return -1;
      return Number(a.shed) - Number(b.shed);
    });
}

function buildSections(
  rows: ReadonlyArray<WidgetRow>,
  weaverRows: ReadonlyArray<WeaverEntryRow>,
): ShiftSection[] {
  const shifts: Shift[] = ['morning', 'night'];
  return shifts.map(shift => {
    const shiftRows = rows.filter(r => r.shift === shift);
    const first = shiftRows[0];
    const isWorking = first?.is_working ?? true;
    const reason = first?.reason ?? null;
    const remark = first?.remark ?? null;
    const roles = shiftRows
      .filter(r => r.employee_role)
      .map(r => ({
        role: r.employee_role ?? '',
        headcount: Number(r.headcount ?? 0),
        presentCount: Number(r.present_count ?? 0),
      }))
      .sort((a, b) => a.role.localeCompare(b.role));
    const totalHeadcount = roles.reduce((s, r) => s + r.headcount, 0);
    const totalPresent = roles.reduce((s, r) => s + r.presentCount, 0);
    const weaverSheds = buildWeaverSheds(weaverRows, shift);
    return { shift, isWorking, reason, remark, roles, totalHeadcount, totalPresent, weaverSheds };
  });
}

function presentTone(present: number, headcount: number): string {
  if (headcount === 0) return 'text-ink-soft';
  const pct = (present / headcount) * 100;
  if (pct >= 90) return 'text-emerald-700';
  if (pct >= 75) return 'text-amber-700';
  return 'text-rose-700';
}

export async function TodayAttendanceWidget(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  // Today's date in factory time (IST) — the server runs in UTC, so a
  // plain new Date() would point at yesterday until 5:30 AM.
  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  // v_today_attendance_widget was added in migration 027 after the last
  // typegen run; cast the table name so supabase-js's generated union accepts
  // it. Regenerate database.types.ts to drop the cast.
  const [{ data, error }, { data: weaverData }] = await Promise.all([
    sb.from('v_today_attendance_widget').select('*'),
    // Present weavers today with the shed(s) they were marked into,
    // so each shift card can list names shed-wise.
    sb.from('attendance_entry')
      .select('status, shed_no, shed_nos, day:attendance_day_id!inner(shift, attendance_date), employee:employee_id!inner(full_name, role, home_shed_no)')
      .eq('day.attendance_date', todayIso)
      .eq('employee.role', 'weaver')
      .in('status', ['present', 'half_day', 'late', 'early_leave']),
  ]);

  const rows = (data as unknown as WidgetRow[]) ?? [];
  const weaverRows = (weaverData as unknown as WeaverEntryRow[]) ?? [];
  const sections = buildSections(rows, weaverRows);
  const noEmployees = rows.length === 0;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-indigo" />
          <h2 className="font-display font-bold text-base">Today&rsquo;s Attendance</h2>
          <span className="text-xs text-ink-mute ml-1">{fmtToday()}</span>
        </div>
        <Link
          href="/app/attendance/mark"
          className="btn-primary inline-flex items-center gap-1.5 min-h-[40px]"
        >
          Mark Attendance <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {error && (
        <div className="text-sm text-err mb-3">
          Could not load attendance: {error.message}
        </div>
      )}

      {noEmployees ? (
        <p className="text-sm text-ink-soft py-3">
          No active employees in the master yet. Add staff in{' '}
          <Link href="/app/employees" className="text-indigo font-semibold">
            Employees
          </Link>{' '}
          to start marking attendance.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {sections.map(sec => (
            <ShiftCard key={sec.shift} section={sec} />
          ))}
        </div>
      )}
    </section>
  );
}

function ShiftCard({ section }: { section: ShiftSection }) {
  const { shift, isWorking, reason, remark, totalHeadcount, totalPresent, weaverSheds } = section;

  return (
    <div className="rounded-lg border border-line/60 p-3 bg-cloud/10">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-sm font-semibold capitalize">{SHIFT_LABEL[shift]}</h3>
        {isWorking && totalHeadcount > 0 && (
          <span
            className={`text-xs font-semibold tabular-nums ${presentTone(
              totalPresent,
              totalHeadcount,
            )}`}
          >
            {totalPresent} / {totalHeadcount}
          </span>
        )}
      </div>

      {!isWorking ? (
        <div className="flex items-start gap-2 rounded bg-rose-50 border border-rose-200 text-rose-800 px-2.5 py-2 text-xs">
          <CalendarOff className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-semibold">
              {REASON_LABEL[reason ?? ''] ?? reason ?? 'Non-working'} — shift off
            </div>
            {remark && <div className="text-rose-700 mt-0.5">{remark}</div>}
          </div>
        </div>
      ) : weaverSheds.length === 0 ? (
        <p className="text-xs text-ink-soft py-1">
          Nobody marked yet for this shift.
        </p>
      ) : (
        /* Shed-wise weaver names — who is running which shed in this
           shift. Only present weavers are listed. */
        <div className="space-y-1.5">
          {weaverSheds.map(s => (
            <div key={s.shed} className="flex items-start gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-mute whitespace-nowrap mt-0.5 w-12 shrink-0">
                {s.shed === '—' ? 'No shed' : `Shed ${s.shed}`}
              </span>
              <span className="flex flex-wrap gap-1">
                {s.names.map(n => (
                  <span key={n} className="inline-block rounded-md bg-indigo-50 text-indigo border border-indigo-100 px-1.5 py-0.5 text-[11px] font-semibold">
                    {n}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
