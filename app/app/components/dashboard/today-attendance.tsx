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

function buildSections(rows: ReadonlyArray<WidgetRow>): ShiftSection[] {
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
    return { shift, isWorking, reason, remark, roles, totalHeadcount, totalPresent };
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
  // v_today_attendance_widget was added in migration 027 after the last
  // typegen run; cast the table name so supabase-js's generated union accepts
  // it. Regenerate database.types.ts to drop the cast.
  const { data, error } = await supabase
    .from('v_today_attendance_widget' as never)
    .select('*');

  const rows = (data as unknown as WidgetRow[]) ?? [];
  const sections = buildSections(rows);
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
  const { shift, isWorking, reason, remark, roles, totalHeadcount, totalPresent } = section;

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
      ) : roles.length === 0 ? (
        <p className="text-xs text-ink-soft py-1">
          Nobody marked yet for this shift.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {roles.map(r => (
            <li
              key={r.role}
              className="flex items-center justify-between py-0.5"
            >
              <span className="capitalize text-ink-soft text-xs">{r.role}</span>
              <span
                className={`text-xs font-semibold tabular-nums ${presentTone(
                  r.presentCount,
                  r.headcount,
                )}`}
              >
                {r.presentCount} / {r.headcount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
