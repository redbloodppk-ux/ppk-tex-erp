/**
 * Attendance by Role (CORR-A5)
 *
 * Rolls every employee in a role into one row for a chosen month — head-
 * count, status counts and a present % bar. Useful for spotting whether a
 * whole role (weavers / sizers / loaders…) is running short.
 *
 * Source: v_attendance_by_role.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { Users } from 'lucide-react';

export const metadata = { title: 'Attendance by Role' };
export const dynamic = 'force-dynamic';

interface RoleRow {
  month: string | null;
  employee_role: string | null;
  employee_count: number | null;
  present_count: number | null;
  absent_count: number | null;
  half_day_count: number | null;
  late_count: number | null;
  early_leave_count: number | null;
  shifts_marked: number | null;
  present_pct: number | null;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function fmtMonth(ym: string): string {
  return new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
  });
}

function pctTone(pct: number): string {
  if (pct >= 90) return 'bg-emerald-500';
  if (pct >= 75) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default async function AttendanceByRoleReport({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('v_attendance_by_role')
    .select('*')
    .eq('month', month)
    .order('employee_role');

  const rows = (data as unknown as RoleRow[]) ?? [];

  const totals = rows.reduce(
    (acc, r) => ({
      employees: acc.employees + (r.employee_count ?? 0),
      present: acc.present + (r.present_count ?? 0),
      absent: acc.absent + (r.absent_count ?? 0),
      half: acc.half + (r.half_day_count ?? 0),
      late: acc.late + (r.late_count ?? 0),
      early: acc.early + (r.early_leave_count ?? 0),
      shifts: acc.shifts + (r.shifts_marked ?? 0),
    }),
    { employees: 0, present: 0, absent: 0, half: 0, late: 0, early: 0, shifts: 0 },
  );
  const overallPct =
    totals.shifts > 0 ? Math.round((1000 * totals.present) / totals.shifts) / 10 : 0;

  const exportColumns: ExcelColumn[] = [
    { key: 'employee_role', label: 'Role', type: 'text' },
    { key: 'employee_count', label: 'Headcount', type: 'number', total: true },
    { key: 'present_count', label: 'Present', type: 'number', total: true },
    { key: 'absent_count', label: 'Absent', type: 'number', total: true },
    { key: 'half_day_count', label: 'Half day', type: 'number', total: true },
    { key: 'late_count', label: 'Late', type: 'number', total: true },
    { key: 'early_leave_count', label: 'Early leave', type: 'number', total: true },
    { key: 'shifts_marked', label: 'Shifts marked', type: 'number', total: true },
    { key: 'present_pct', label: 'Present %', type: 'percent' },
  ];

  return (
    <div>
      <PageHeader
        title="Attendance by Role"
        subtitle="Roll-up of attendance by role for one month — how each role group is showing up."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Attendance — By Role' },
        ]}
        actions={
          rows.length > 0 ? (
            <ExcelExportButton
              filename={`attendance-by-role-${month}`}
              sheetName="Attendance by Role"
              title={`Attendance by Role — ${fmtMonth(month)}`}
              columns={exportColumns}
              rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
            />
          ) : undefined
        }
      />

      <form method="GET" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="month">
            Month
          </label>
          <input
            id="month"
            name="month"
            type="month"
            defaultValue={month}
            max={currentMonth()}
            className="input"
          />
        </div>
        <button type="submit" className="btn-primary min-h-[44px]">
          Show
        </button>
        <span className="text-xs text-ink-mute ml-1">Showing {fmtMonth(month)}</span>
      </form>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load report: {error.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <KpiCard label="Roles" value={rows.length} tone="text-ink" />
        <KpiCard label="Total people" value={totals.employees} tone="text-ink" />
        <KpiCard label="Present" value={totals.present} tone="text-emerald-700" />
        <KpiCard
          label="Overall present %"
          value={`${overallPct}%`}
          tone={overallPct >= 90 ? 'text-emerald-700' : overallPct >= 75 ? 'text-amber-700' : 'text-rose-700'}
        />
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <Users className="w-4 h-4 text-ink-mute" />
        <h2 className="text-base font-semibold">Roles</h2>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No attendance has been marked in {fmtMonth(month)} yet.
        </div>
      ) : (
        <>
        <CardFilter placeholder="Search roles…">
          {rows.map(r => {
            const pct = r.present_pct ?? 0;
            return (
              <div key={r.employee_role ?? ''} className="card p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-ink capitalize break-words">{r.employee_role ?? '—'}</div>
                  <span className="text-xs tabular-nums text-ink-soft shrink-0">{r.employee_count ?? 0} people</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <div className="flex-1 h-2 bg-cloud/60 rounded overflow-hidden">
                    <div
                      className={`h-full ${pctTone(pct)}`}
                      style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                    />
                  </div>
                  <span className="text-xs tabular-nums w-12 text-right">{pct.toFixed(1)}%</span>
                </div>
                <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                  <div>Present: <span className="tabular-nums text-emerald-700">{r.present_count ?? 0}</span></div>
                  <div>Absent: <span className="tabular-nums text-rose-700">{r.absent_count ?? 0}</span></div>
                  <div>Half day: <span className="tabular-nums text-amber-700">{r.half_day_count ?? 0}</span></div>
                  <div>Late: <span className="tabular-nums text-orange-700">{r.late_count ?? 0}</span></div>
                  <div>Early leave: <span className="tabular-nums text-sky-700">{r.early_leave_count ?? 0}</span></div>
                  <div>Shifts: <span className="tabular-nums">{r.shifts_marked ?? 0}</span></div>
                </div>
              </div>
            );
          })}
        </CardFilter>
        <div className="card p-0 overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-right px-3 py-2">People</th>
                <th className="text-right px-3 py-2">Present</th>
                <th className="text-right px-3 py-2">Absent</th>
                <th className="text-right px-3 py-2">Half&nbsp;day</th>
                <th className="text-right px-3 py-2">Late</th>
                <th className="text-right px-3 py-2">Early&nbsp;leave</th>
                <th className="text-right px-3 py-2">Shifts</th>
                <th className="text-left px-3 py-2 min-w-[180px]">Present %</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const pct = r.present_pct ?? 0;
                return (
                  <tr
                    key={r.employee_role ?? ''}
                    className="border-t border-line/40 hover:bg-cloud/20"
                  >
                    <td className="px-3 py-2 capitalize font-medium">
                      {r.employee_role ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.employee_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                      {r.present_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                      {r.absent_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-amber-700">
                      {r.half_day_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-orange-700">
                      {r.late_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-sky-700">
                      {r.early_leave_count ?? 0}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.shifts_marked ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-cloud/60 rounded overflow-hidden">
                          <div
                            className={`h-full ${pctTone(pct)}`}
                            style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums w-12 text-right">
                          {pct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
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

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${tone}`}>{value}</div>
    </div>
  );
}
