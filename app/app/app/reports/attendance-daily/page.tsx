/**
 * Daily Attendance (CORR-A5)
 *
 * Who worked on one chosen date, across both shifts. Pick a date with the
 * little form at the top — it submits as a normal GET so the page stays a
 * server component. Defaults to today.
 *
 * Source: v_attendance_detail (working days only) plus v_non_working_days
 * so a holiday on the chosen date is shown instead of an empty table.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { CalendarDays, CalendarOff } from 'lucide-react';

export const metadata = { title: 'Daily Attendance' };
export const dynamic = 'force-dynamic';

// Daily attendance report intentionally restricts itself to present + absent.
// Half-day / late / early-leave still get saved on the attendance page, but
// they're not shown here per business rule (cleaner daily summary).
type Status = 'present' | 'absent';
type RawStatus = 'present' | 'absent' | 'half_day' | 'late' | 'early_leave';

interface DetailRow {
  attendance_date: string | null;
  shift: string | null;
  employee_id: number | null;
  employee_code: string | null;
  employee_name: string | null;
  employee_role: string | null;
  status: RawStatus | null;
  day_weight: number | null;
  entry_remark: string | null;
}

interface NonWorkingRow {
  shift: string | null;
  reason: string | null;
  remark: string | null;
}

const STATUS_LABEL: Record<Status, string> = {
  present: 'Present',
  absent: 'Absent',
};

const STATUS_TONE: Record<Status, string> = {
  present: 'text-emerald-700',
  absent: 'text-rose-700',
};

const REASON_LABEL: Record<string, string> = {
  power_cut: 'Power cut',
  national_holiday: 'National holiday',
  maintenance: 'Maintenance',
  other: 'Other',
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default async function DailyAttendanceReport({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today();

  const supabase = await createClient();

  const { data: detailData, error } = await supabase
    .from('v_attendance_detail')
    .select('*')
    .eq('attendance_date', date)
    .order('employee_name');

  const { data: nwData } = await supabase
    .from('v_non_working_days')
    .select('shift, reason, remark')
    .eq('attendance_date', date);

  const allRows = (detailData as unknown as DetailRow[]) ?? [];
  // Only show present + absent in the daily summary. Other statuses are
  // captured on the attendance screen but excluded from this report.
  const rows = allRows.filter(
    (r): r is DetailRow & { status: Status } =>
      r.status === 'present' || r.status === 'absent',
  );
  const nonWorking = (nwData as unknown as NonWorkingRow[]) ?? [];

  const counts: Record<Status, number> = {
    present: 0,
    absent: 0,
  };
  for (const r of rows) counts[r.status] += 1;
  const totalMarked = rows.length;

  const exportColumns: ExcelColumn[] = [
    { key: 'shift', label: 'Shift', type: 'text' },
    { key: 'employee_code', label: 'Code', type: 'text' },
    { key: 'employee_name', label: 'Employee', type: 'text' },
    { key: 'employee_role', label: 'Role', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'day_weight', label: 'Day weight', type: 'number' },
    { key: 'entry_remark', label: 'Remark', type: 'text' },
  ];

  return (
    <div>
      <PageHeader
        title="Daily Attendance"
        subtitle="Everyone who was marked on one date, across both shifts. Pick any date below."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Attendance — Daily' },
        ]}
        actions={
          totalMarked > 0 ? (
            <ExcelExportButton
              filename={`daily-attendance-${date}`}
              sheetName="Daily Attendance"
              title={`Daily Attendance — ${date}`}
              columns={exportColumns}
              rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
            />
          ) : undefined
        }
      />

      <form method="GET" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="date">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={date}
            max={today()}
            className="input"
          />
        </div>
        <button type="submit" className="btn-primary min-h-[44px]">
          Show
        </button>
        <span className="text-xs text-ink-mute ml-1">
          Showing {fmtDate(date)}
        </span>
      </form>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load attendance: {error.message}
        </div>
      )}

      {nonWorking.length > 0 && (
        <div className="card p-3 mb-4 border border-amber-200 bg-amber-50/50">
          {nonWorking.map((n, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-sm text-amber-800"
            >
              <CalendarOff className="w-4 h-4" />
              <span className="capitalize font-medium">{n.shift}</span> shift
              marked as a holiday — {REASON_LABEL[n.reason ?? ''] ?? n.reason}
              {n.remark ? ` (${n.remark})` : ''}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-6">
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <div key={s} className="card p-3">
            <div className="text-xs text-ink-mute">{STATUS_LABEL[s]}</div>
            <div className={`text-lg font-semibold mt-1 ${STATUS_TONE[s]}`}>
              {counts[s]}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <CalendarDays className="w-4 h-4 text-ink-mute" />
        <h2 className="text-base font-semibold">Marked employees</h2>
        <span className="text-xs text-ink-mute ml-1">{totalMarked} total</span>
      </div>

      {totalMarked === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          {nonWorking.length > 0
            ? 'This date was a holiday — no per-employee attendance to show.'
            : 'No attendance has been marked for this date yet.'}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Shift</th>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={`${r.employee_id}-${r.shift}-${i}`}
                  className="border-t border-line/40 hover:bg-cloud/20"
                >
                  <td className="px-3 py-2 capitalize text-xs">{r.shift}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.employee_name ?? '—'}</div>
                    <div className="text-xs text-ink-mute">
                      {r.employee_code ?? '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize text-xs">
                    {r.employee_role ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-xs font-semibold ${
                        r.status ? STATUS_TONE[r.status] : ''
                      }`}
                    >
                      {r.status ? STATUS_LABEL[r.status] : '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">
                    {r.entry_remark ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
