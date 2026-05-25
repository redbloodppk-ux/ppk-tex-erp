'use client';
/**
 * Daily Attendance Marking — CORR-A2.
 *
 * Flow:
 *   1. Pick a date (default today) and a shift (Morning / Night).
 *   2. Optionally filter the employee list by role.
 *   3. For every active employee tap one status: Present, Absent,
 *      Half day, Late or Early leave. A fresh day starts everyone on
 *      "Present" so only the exceptions need a tap.
 *   4. "Mark all present" resets the whole visible list in one tap.
 *   5. "Save" writes one attendance_entry row per employee.
 *
 * Holidays: "Mark day as holiday" records the whole date/shift as a
 * non-working day (attendance_day.is_working = false) with a reason.
 * On a holiday no per-employee rows are needed, so the grid is hidden.
 *
 * Data model (existing schema):
 *   attendance_day    one row per (attendance_date, shift)
 *   attendance_entry  one row per (attendance_day_id, employee_id)
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { HolidayModal } from '@/app/components/attendance/holiday-modal';
import { Loader2, Save, CheckCircle2, CalendarOff, Undo2 } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type AttendanceStatus = Database['public']['Enums']['attendance_status'];
type ShiftCode = Database['public']['Enums']['shift_code'];
type NonWorkingReason = Database['public']['Enums']['non_working_reason'];

interface Employee {
  id: number;
  code: string;
  full_name: string;
  role: string;
}

const STATUSES: { value: AttendanceStatus; label: string; on: string; off: string }[] = [
  { value: 'present', label: 'Present', on: 'bg-emerald-600 text-white', off: 'hover:bg-emerald-50 text-emerald-700' },
  { value: 'absent', label: 'Absent', on: 'bg-rose-600 text-white', off: 'hover:bg-rose-50 text-rose-700' },
  { value: 'half_day', label: 'Half day', on: 'bg-amber-500 text-white', off: 'hover:bg-amber-50 text-amber-700' },
  { value: 'late', label: 'Late', on: 'bg-orange-500 text-white', off: 'hover:bg-orange-50 text-orange-700' },
  { value: 'early_leave', label: 'Early leave', on: 'bg-sky-600 text-white', off: 'hover:bg-sky-50 text-sky-700' },
];

const HOLIDAY_REASONS: { value: NonWorkingReason; label: string }[] = [
  { value: 'power_cut', label: 'Power cut' },
  { value: 'national_holiday', label: 'National holiday' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'other', label: 'Other' },
];

const today = (): string => new Date().toISOString().slice(0, 10);

export default function AttendanceMarkPage() {
  const supabase = createClient();

  const [markDate, setMarkDate] = useState<string>(today());
  const [shift, setShift] = useState<ShiftCode>('morning');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [statusByEmp, setStatusByEmp] = useState<Record<number, AttendanceStatus>>({});

  // Holiday state for the selected date + shift.
  const [isHoliday, setIsHoliday] = useState<boolean>(false);
  const [holidayReason, setHolidayReason] = useState<NonWorkingReason>('national_holiday');
  const [holidayRemark, setHolidayRemark] = useState<string>('');
  const [holidayModalOpen, setHolidayModalOpen] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  // Load the active employee list once.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('employee')
        .select('id, code, full_name, role')
        .eq('status', 'active')
        .order('full_name');
      if (!active) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setEmployees((data ?? []) as Employee[]);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Load the attendance day + entries whenever date / shift / employees change.
  const loadDay = useCallback(async () => {
    if (employees.length === 0) return;
    setLoading(true);
    setError(null);
    setSavedMsg(null);

    const { data: day, error: dayErr } = await supabase
      .from('attendance_day')
      .select('id, is_working, reason, remark')
      .eq('attendance_date', markDate)
      .eq('shift', shift)
      .maybeSingle();

    if (dayErr) {
      setError(dayErr.message);
      setLoading(false);
      return;
    }

    if (day && day.is_working === false) {
      setIsHoliday(true);
      setHolidayReason((day.reason ?? 'national_holiday') as NonWorkingReason);
      setHolidayRemark(day.remark ?? '');
      setStatusByEmp({});
      setLoading(false);
      return;
    }

    setIsHoliday(false);
    setHolidayRemark('');

    let entries: { employee_id: number; status: AttendanceStatus }[] = [];
    if (day) {
      const { data: ent, error: entErr } = await supabase
        .from('attendance_entry')
        .select('employee_id, status')
        .eq('attendance_day_id', day.id);
      if (entErr) {
        setError(entErr.message);
        setLoading(false);
        return;
      }
      entries = (ent ?? []) as typeof entries;
    }

    const byEmp = new Map<number, AttendanceStatus>();
    for (const e of entries) byEmp.set(e.employee_id, e.status);

    // Fresh / unmarked employees start on "present" so only exceptions
    // need a tap.
    const next: Record<number, AttendanceStatus> = {};
    for (const emp of employees) next[emp.id] = byEmp.get(emp.id) ?? 'present';
    setStatusByEmp(next);
    setLoading(false);
  }, [supabase, employees, markDate, shift]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const roles = Array.from(new Set(employees.map((e) => e.role))).sort();
  const visible = employees.filter((e) => roleFilter === 'all' || e.role === roleFilter);

  function setStatus(empId: number, status: AttendanceStatus): void {
    setStatusByEmp((prev) => ({ ...prev, [empId]: status }));
    setSavedMsg(null);
  }

  function markAllPresent(): void {
    setStatusByEmp((prev) => {
      const next = { ...prev };
      for (const e of visible) next[e.id] = 'present';
      return next;
    });
    setSavedMsg(null);
  }

  async function ensureDay(isWorking: boolean): Promise<number | null> {
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from('attendance_day')
      .upsert(
        {
          attendance_date: markDate,
          shift,
          is_working: isWorking,
          reason: isWorking ? null : holidayReason,
          remark: isWorking ? null : holidayRemark.trim() || null,
          marked_by: user?.id ?? null,
          marked_at: new Date().toISOString(),
        },
        { onConflict: 'attendance_date,shift' },
      )
      .select('id')
      .single();
    if (err) {
      setError(err.message);
      return null;
    }
    return data.id;
  }

  async function handleSaveAttendance(): Promise<void> {
    setError(null);
    setSavedMsg(null);
    setSaving(true);

    const dayId = await ensureDay(true);
    if (dayId == null) {
      setSaving(false);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    const rows = employees.map((emp) => ({
      attendance_day_id: dayId,
      employee_id: emp.id,
      status: statusByEmp[emp.id] ?? 'present',
      marked_by: user?.id ?? null,
      marked_at: new Date().toISOString(),
    }));

    const { error: err } = await supabase
      .from('attendance_entry')
      .upsert(rows, { onConflict: 'attendance_day_id,employee_id' });

    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSavedMsg(`Saved attendance for ${rows.length} employees.`);
  }

  async function handleClearHoliday(): Promise<void> {
    setError(null);
    setSavedMsg(null);
    setSaving(true);
    const dayId = await ensureDay(true);
    setSaving(false);
    if (dayId == null) return;
    setIsHoliday(false);
    await loadDay();
  }

  const summary = STATUSES.map((s) => ({
    ...s,
    count: visible.filter((e) => statusByEmp[e.id] === s.value).length,
  }));

  return (
    <div>
      <PageHeader
        title="Mark Attendance"
        subtitle="Record who worked each shift. A new day starts everyone on Present — just change the exceptions."
        crumbs={[{ label: 'Attendance', href: '/app/attendance' }, { label: 'Mark' }]}
      />

      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label" htmlFor="mark-date">
              Date
            </label>
            <input
              id="mark-date"
              type="date"
              className="input"
              value={markDate}
              max={today()}
              onChange={(e) => setMarkDate(e.target.value)}
            />
          </div>
          <div>
            <span className="label">Shift</span>
            <div className="flex gap-2">
              {(['morning', 'night'] as ShiftCode[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setShift(s)}
                  className={
                    'capitalize min-h-[44px] ' +
                    (shift === s ? 'btn-primary' : 'btn-ghost')
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label" htmlFor="role-filter">
              Role
            </label>
            <select
              id="role-filter"
              className="input capitalize"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="all">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r} className="capitalize">
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && <p className="text-sm text-err">{error}</p>}
        {savedMsg && (
          <p className="flex items-center gap-1.5 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4" />
            {savedMsg}
          </p>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-ink-mute">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading employees…
          </div>
        ) : isHoliday ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <CalendarOff className="h-5 w-5" />
              This {shift} shift is marked as a holiday.
            </div>
            <p className="text-sm text-amber-700">
              Reason: {HOLIDAY_REASONS.find((r) => r.value === holidayReason)?.label}
              {holidayRemark ? ` — ${holidayRemark}` : ''}
            </p>
            <button
              type="button"
              className="btn-ghost flex items-center gap-1.5 min-h-[44px]"
              onClick={handleClearHoliday}
              disabled={saving}
            >
              <Undo2 className="h-4 w-4" />
              This was not a holiday — mark attendance instead
            </button>
          </div>
        ) : (
          <>
            {/* Summary chips */}
            <div className="flex flex-wrap gap-2 text-xs">
              {summary.map((s) => (
                <span
                  key={s.value}
                  className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-ink-soft"
                >
                  {s.label}: <span className="num">{s.count}</span>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-ghost min-h-[44px]"
                onClick={markAllPresent}
              >
                Mark all present
              </button>
              <button
                type="button"
                className="btn-ghost flex items-center gap-1.5 min-h-[44px]"
                onClick={() => setHolidayModalOpen(true)}
                disabled={saving}
              >
                <CalendarOff className="h-4 w-4" />
                Mark day as holiday
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line/60 text-left text-ink-mute">
                    <th className="py-2 pr-3">Employee</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-ink-soft">
                        No employees for this role.
                      </td>
                    </tr>
                  )}
                  {visible.map((emp) => (
                    <tr key={emp.id} className="border-b border-line/60">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{emp.full_name}</div>
                        <div className="text-xs text-ink-mute capitalize">
                          {emp.code} · {emp.role}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1.5">
                          {STATUSES.map((s) => {
                            const active = statusByEmp[emp.id] === s.value;
                            return (
                              <button
                                key={s.value}
                                type="button"
                                onClick={() => setStatus(emp.id, s.value)}
                                className={
                                  'min-h-[44px] rounded-md border border-line px-3 text-xs font-semibold transition ' +
                                  (active ? s.on + ' border-transparent' : 'bg-white ' + s.off)
                                }
                              >
                                {s.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 min-h-[44px]"
                onClick={handleSaveAttendance}
                disabled={saving || loading}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save attendance
              </button>
              <span className="text-xs text-ink-mute">
                Saving again overwrites the earlier entry for this date and shift.
              </span>
            </div>
          </>
        )}
      </div>

      <HolidayModal
        open={holidayModalOpen}
        date={markDate}
        defaultShift={shift}
        onClose={() => setHolidayModalOpen(false)}
        onSaved={() => {
          setHolidayModalOpen(false);
          setSavedMsg('Day marked as a holiday.');
          void loadDay();
        }}
      />
    </div>
  );
}
