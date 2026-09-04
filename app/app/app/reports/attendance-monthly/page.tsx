/**
 * Monthly Attendance Summary (CORR-A5)
 *
 * One row per employee for a chosen month — present / absent / half-day /
 * late / early-leave counts, shifts marked and total attendance days.
 *
 * Source: v_attendance_monthly (working days only). Filter by month is a
 * normal GET form so the page stays a server component.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import { CalendarRange } from 'lucide-react';
import { recordDateBounds, clampDate, SOURCES as DATE_SOURCES } from '@/lib/reports/record-bounds';

export const metadata = { title: 'Monthly Attendance' };
export const dynamic = 'force-dynamic';

interface MonthlyRow {
  employee_id: number | null;
  employee_code: string | null;
  employee_name: string | null;
  employee_role: string | null;
  present_count: number | null;
  absent_count: number | null;
  half_day_count: number | null;
  late_count: number | null;
  early_leave_count: number | null;
  shifts_marked: number | null;
  attendance_days: number | null;
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

const isIso = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Last calendar day of a YYYY-MM. */
function monthEnd(ym: string): string {
  const d = new Date(ym + '-01T00:00:00');
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${m[3]}-${months[Number(m[2]) - 1]}-${m[1]}`;
}

export default async function MonthlyAttendanceReport({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; role?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const role = sp.role && sp.role.trim() ? sp.role.trim() : null;

  const supabase = await createClient();

  // PPK, 2026-09-04: "we need date range selection also for this report."
  // Two ways to ask the same question, so the month picker stays for the
  // common case and a From/To pair handles everything a calendar month
  // cannot — a pay week straddling month end, for instance.
  //
  // Presence of a From or To is what selects range mode: there is no
  // separate toggle to get out of step with the dates beside it.
  const bounds = await recordDateBounds(supabase, DATE_SOURCES.attendance);
  const rangeMode = isIso(sp.from) || isIso(sp.to);

  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : currentMonth();
  const rawFrom = rangeMode ? (isIso(sp.from) ? sp.from : (bounds?.min ?? `${month}-01`)) : `${month}-01`;
  const rawTo = rangeMode ? (isIso(sp.to) ? sp.to : (bounds?.max ?? monthEnd(month))) : monthEnd(month);
  const from = clampDate(rawFrom, bounds);
  const toClamped = clampDate(rawTo, bounds);
  // A To before From would return nothing and look like "no attendance".
  const to = toClamped < from ? from : toClamped;

  const periodLabel = rangeMode
    ? `${fmtDay(from)} to ${fmtDay(to)}`
    : fmtMonth(month);

  // Both modes call the same function (migration 279) — the month view is
  // itself a wrapper over it, so a month asked either way gives identical
  // counts by construction rather than by coincidence.
  const { data, error } = await supabase
    .rpc('fn_attendance_summary', { p_from: from, p_to: to });

  const allRows = ((data as unknown as MonthlyRow[]) ?? [])
    .sort((a, b) => (a.employee_name ?? '').localeCompare(b.employee_name ?? ''));

  // Role filter applied here rather than in the query: the function returns
  // one row per employee, so this is a handful of rows and filtering in SQL
  // would mean casting a free-form string to the employee_role enum.
  const rows = role
    ? allRows.filter((r) => (r.employee_role ?? '') === role)
    : allRows;

  // Roles offered are those present in the chosen period.
  const allRoles = Array.from(
    new Set(allRows.map(r => r.employee_role).filter((r): r is string => Boolean(r))),
  ).sort();

  const totals = rows.reduce(
    (acc, r) => ({
      present: acc.present + (r.present_count ?? 0),
      absent: acc.absent + (r.absent_count ?? 0),
      half: acc.half + (r.half_day_count ?? 0),
      late: acc.late + (r.late_count ?? 0),
      early: acc.early + (r.early_leave_count ?? 0),
      shifts: acc.shifts + (r.shifts_marked ?? 0),
      days: acc.days + (r.attendance_days ?? 0),
    }),
    { present: 0, absent: 0, half: 0, late: 0, early: 0, shifts: 0, days: 0 },
  );

  const exportColumns: ExcelColumn[] = [
    { key: 'employee_code', label: 'Code', type: 'text' },
    { key: 'employee_name', label: 'Employee', type: 'text' },
    { key: 'employee_role', label: 'Role', type: 'text' },
    { key: 'present_count', label: 'Present', type: 'number', total: true },
    { key: 'absent_count', label: 'Absent', type: 'number', total: true },
    { key: 'half_day_count', label: 'Half day', type: 'number', total: true },
    { key: 'late_count', label: 'Late', type: 'number', total: true },
    { key: 'early_leave_count', label: 'Early leave', type: 'number', total: true },
    { key: 'shifts_marked', label: 'Shifts marked', type: 'number', total: true },
    { key: 'attendance_days', label: 'Attendance days', type: 'number', total: true },
  ];

  return (
    <div>
      <PageHeader
        title="Monthly Attendance"
        subtitle="Per-employee summary for a month or any date range. Optionally narrow by role."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Attendance — Monthly' },
        ]}
        actions={
          rows.length > 0 ? (
            <ExcelExportButton
              filename={`attendance-${rangeMode ? `${from}-to-${to}` : month}${role ? '-' + role : ''}`}
              sheetName="Attendance"
              title={`Attendance — ${periodLabel}${role ? ` (${role})` : ''}`}
              columns={exportColumns}
              rows={rows as unknown as ReadonlyArray<Record<string, unknown>>}
            />
          ) : undefined
        }
      />

      {/* Two forms, not one. A single form would submit month AND dates
          together, and the page would have to guess which the operator
          meant. Separate forms make the choice by which button is pressed. */}
      <form method="GET" className="card p-3 mb-3 flex flex-wrap items-end gap-3">
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
        <div>
          <label className="label" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            name="role"
            defaultValue={role ?? ''}
            className="input min-w-[160px]"
          >
            <option value="">All roles</option>
            {allRoles.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary min-h-[44px]">
          Show month
        </button>
        <span className="text-xs text-ink-mute ml-1">
          Showing {periodLabel}
          {role ? ` — ${role}` : ''}
        </span>
      </form>

      {/* Date range — for anything a calendar month cannot express, such as
          a pay week that straddles month end. Bounded to the days that have
          attendance, so a range over months with no records cannot be
          picked. Role is repeated as a hidden field so switching to a range
          does not silently drop the role filter. */}
      <form method="GET" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        {role && <input type="hidden" name="role" value={role} />}
        <div>
          <label className="label" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={from}
            min={bounds?.min} max={bounds?.max} className="input" />
        </div>
        <div>
          <label className="label" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={to}
            min={from || bounds?.min} max={bounds?.max} className="input" />
        </div>
        <button type="submit" className="btn-secondary min-h-[44px]">
          Show date range
        </button>
        {bounds && (
          <span className="text-xs text-ink-mute ml-1">
            Attendance recorded {fmtDay(bounds.min)} to {fmtDay(bounds.max)}
          </span>
        )}
      </form>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load report: {error.message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiCard label="Present" value={totals.present} tone="text-emerald-700" />
        <KpiCard label="Absent" value={totals.absent} tone="text-rose-700" />
        <KpiCard label="Half day" value={totals.half} tone="text-amber-700" />
        <KpiCard label="Late" value={totals.late} tone="text-orange-700" />
        <KpiCard label="Early leave" value={totals.early} tone="text-sky-700" />
      </div>

      <div className="flex items-baseline gap-2 mb-2">
        <CalendarRange className="w-4 h-4 text-ink-mute" />
        <h2 className="text-base font-semibold">Employees</h2>
        <span className="text-xs text-ink-mute ml-1">{rows.length} people</span>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-mute">
          No attendance has been marked in {periodLabel} yet
          {role ? ` for role "${role}"` : ''}.
        </div>
      ) : (
        <>
        <CardFilter placeholder="Search employees…">
          {rows.map(r => (
            <div key={r.employee_id ?? r.employee_code ?? r.employee_name} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-ink break-words">{r.employee_name ?? '—'}</div>
                  <div className="text-xs text-ink-mute">{r.employee_code ?? '—'}</div>
                </div>
                <span className="text-xs tabular-nums font-semibold shrink-0">{r.attendance_days ?? 0} days</span>
              </div>
              <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <div>Role: <span className="capitalize text-ink">{r.employee_role ?? '—'}</span></div>
                <div>Shifts: <span className="tabular-nums">{r.shifts_marked ?? 0}</span></div>
                <div>Present: <span className="tabular-nums text-emerald-700">{r.present_count ?? 0}</span></div>
                <div>Absent: <span className="tabular-nums text-rose-700">{r.absent_count ?? 0}</span></div>
                <div>Half day: <span className="tabular-nums text-amber-700">{r.half_day_count ?? 0}</span></div>
                <div>Late: <span className="tabular-nums text-orange-700">{r.late_count ?? 0}</span></div>
                <div>Early leave: <span className="tabular-nums text-sky-700">{r.early_leave_count ?? 0}</span></div>
              </div>
            </div>
          ))}
        </CardFilter>
        <div className="card p-0 overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Employee</th>
                <th className="text-left px-3 py-2">Role</th>
                <th className="text-right px-3 py-2">Present</th>
                <th className="text-right px-3 py-2">Absent</th>
                <th className="text-right px-3 py-2">Half&nbsp;day</th>
                <th className="text-right px-3 py-2">Late</th>
                <th className="text-right px-3 py-2">Early&nbsp;leave</th>
                <th className="text-right px-3 py-2">Shifts</th>
                <th className="text-right px-3 py-2">Days</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.employee_id ?? r.employee_code ?? r.employee_name}
                  className="border-t border-line/40 hover:bg-cloud/20"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.employee_name ?? '—'}</div>
                    <div className="text-xs text-ink-mute">
                      {r.employee_code ?? '—'}
                    </div>
                  </td>
                  <td className="px-3 py-2 capitalize text-xs">
                    {r.employee_role ?? '—'}
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
                  <td className="px-3 py-2 text-right tabular-nums font-semibold">
                    {r.attendance_days ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-cloud/30 text-xs font-semibold">
                <td className="px-3 py-2" colSpan={2}>
                  Total
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.present}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.absent}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.half}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.late}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.early}</td>
                <td className="px-3 py-2 text-right tabular-nums">{totals.shifts}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {totals.days.toFixed(2)}
                </td>
              </tr>
            </tfoot>
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
  value: number;
  tone: string;
}) {
  return (
    <div className="card p-3">
      <div className="text-xs text-ink-mute">{label}</div>
      <div className={`text-lg font-semibold mt-1 ${tone}`}>{value}</div>
    </div>
  );
}
