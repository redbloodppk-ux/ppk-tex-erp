'use client';
/**
 * Daily Attendance Marking — CORR-A2 / CORR-A4.
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
 * Edit windows (CORR-A4): an already-marked day is free to edit for
 * 24 hours, then owner/mill-manager only for the next 6 days, then
 * locked. Every save is appended to audit_log by a table trigger.
 *
 * Data model (existing schema):
 *   attendance_day    one row per (attendance_date, shift)
 *   attendance_entry  one row per (attendance_day_id, employee_id)
 */
import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { PageHeader } from '@/app/components/page-header';
import { HolidayModal } from '@/app/components/attendance/holiday-modal';
import { canEdit, type EditorRole } from '@/lib/attendance/canEdit';
import { enqueue as enqueueOffline, queueCount } from '@/lib/attendance/offlineQueue';
import { Loader2, Save, CheckCircle2, CalendarOff, Undo2, Lock, WifiOff } from 'lucide-react';
import type { Database } from '@/lib/database.types';

type AttendanceStatus = Database['public']['Enums']['attendance_status'];
type ShiftCode = Database['public']['Enums']['shift_code'];
type NonWorkingReason = Database['public']['Enums']['non_working_reason'];

interface Employee {
  id: number;
  code: string;
  full_name: string;
  role: string;
  default_shift: 'morning' | 'night' | 'either' | null;
  // Added in migration 030. Defaults to true so existing rows keep behaviour.
  attendance_required: boolean;
}

// CORR-A7 / shop-floor feedback:
//   'none' is rendered as a grey button and means "this employee was not
//   scheduled this shift" — it does NOT count against him in wage reports.
//   Used for e.g. a morning-only weaver on the night shift screen.
const STATUSES: { value: AttendanceStatus; label: string; on: string; off: string }[] = [
  { value: 'present', label: 'Present', on: 'bg-emerald-600 text-white', off: 'hover:bg-emerald-50 text-emerald-700' },
  { value: 'absent', label: 'Absent', on: 'bg-rose-600 text-white', off: 'hover:bg-rose-50 text-rose-700' },
  { value: 'half_day', label: 'Half day', on: 'bg-amber-500 text-white', off: 'hover:bg-amber-50 text-amber-700' },
  { value: 'late', label: 'Late', on: 'bg-orange-500 text-white', off: 'hover:bg-orange-50 text-orange-700' },
  { value: 'early_leave', label: 'Early leave', on: 'bg-sky-600 text-white', off: 'hover:bg-sky-50 text-sky-700' },
  { value: 'none' as AttendanceStatus, label: 'None', on: 'bg-slate-500 text-white', off: 'hover:bg-slate-100 text-slate-600' },
];

// Statuses where the supervisor needs to record the real in / out time.
const TIME_STATUSES: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>([
  'late',
  'early_leave',
  'half_day',
]);

// Statuses where the employee actually worked some part of the shift and so
// must be tied to a weaving shed (drives metre-basis wage allocation).
const WORKED_STATUSES: ReadonlySet<AttendanceStatus> = new Set<AttendanceStatus>([
  'present',
  'late',
  'early_leave',
  'half_day',
]);

const SHEDS = ['1', '2', '3', '4'] as const;

function defaultStatusFor(emp: Employee, shift: ShiftCode): AttendanceStatus {
  if (emp.default_shift && emp.default_shift !== 'either' && emp.default_shift !== shift) {
    return 'none' as AttendanceStatus;
  }
  return 'present';
}

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
  // CORR-A7 in/out time per employee. Stored as "HH:MM" or null.
  const [inTimeByEmp, setInTimeByEmp] = useState<Record<number, string | null>>({});
  const [outTimeByEmp, setOutTimeByEmp] = useState<Record<number, string | null>>({});
  // Shed where the employee worked this shift. Required for weavers/helpers so
  // the metre-basis wage allocation knows which loom output to apply against.
  const [shedByEmp, setShedByEmp] = useState<Record<number, string | null>>({});

  // Holiday state for the selected date + shift.
  const [isHoliday, setIsHoliday] = useState<boolean>(false);
  const [holidayReason, setHolidayReason] = useState<NonWorkingReason>('national_holiday');
  const [holidayRemark, setHolidayRemark] = useState<string>('');
  const [holidayModalOpen, setHolidayModalOpen] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [offlineMsg, setOfflineMsg] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);

  // Track pending offline saves so we can show the count on the page. Also
  // refresh when the OfflineSync flush event fires.
  useEffect(() => {
    setPendingCount(queueCount());
    function refresh(): void {
      setPendingCount(queueCount());
    }
    window.addEventListener('ppk:queue-changed', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('ppk:queue-changed', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);

  // Edit-window gate (CORR-A4). dayMarkedAt is null for a day that has
  // not been marked yet — such a day is always freely editable.
  const [userRole, setUserRole] = useState<EditorRole | null>(null);
  const [dayMarkedAt, setDayMarkedAt] = useState<string | null>(null);

  // Load the current user's app role once (drives the edit window).
  useEffect(() => {
    let active = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: me } = await supabase
        .from('app_user')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      const r = (me as { role: string } | null)?.role;
      if (r) setUserRole(r as EditorRole);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Load the active employee list once. Employees with attendance_required
  // = false (e.g. salaried staff) are excluded entirely — they still appear
  // on wages but not on this screen. attendance_required was added in
  // migration 030; the `as never` keeps tsc happy until typegen is re-run.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: err } = await supabase
        .from('employee')
        .select('id, code, full_name, role, default_shift, attendance_required')
        .eq('status', 'active')
        .order('full_name');
      if (!active) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const all = (data ?? []) as unknown as Employee[];
      // attendance_required defaults to true; only hide ones explicitly false.
      setEmployees(all.filter((e) => e.attendance_required !== false));
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
    setDayMarkedAt(null);

    const { data: day, error: dayErr } = await supabase
      .from('attendance_day')
      .select('id, is_working, reason, remark, marked_at')
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
    setDayMarkedAt(day?.marked_at ?? null);

    type EntryRow = {
      employee_id: number;
      status: AttendanceStatus;
      actual_in_time: string | null;
      actual_out_time: string | null;
      shed_no: string | null;
    };
    let entries: EntryRow[] = [];
    if (day) {
      const { data: ent, error: entErr } = await supabase
        .from('attendance_entry')
        .select('employee_id, status, actual_in_time, actual_out_time, shed_no')
        .eq('attendance_day_id', day.id);
      if (entErr) {
        setError(entErr.message);
        setLoading(false);
        return;
      }
      // actual_in_time / actual_out_time were added in migration 029 after
      // the last database.types regen — cast through unknown until typegen
      // is re-run.
      entries = (ent ?? []) as unknown as EntryRow[];
    }

    const statusMap = new Map<number, AttendanceStatus>();
    const inMap = new Map<number, string | null>();
    const outMap = new Map<number, string | null>();
    const shedMap = new Map<number, string | null>();
    for (const e of entries) {
      statusMap.set(e.employee_id, e.status);
      inMap.set(e.employee_id, e.actual_in_time);
      outMap.set(e.employee_id, e.actual_out_time);
      shedMap.set(e.employee_id, e.shed_no);
    }

    // Cross-shift default: when marking Night, anyone already saved as
    // 'present' on today's Morning shift should pre-default to 'none' on
    // Night (they already worked the day). The supervisor can still flip
    // them back if a weaver pulls a double shift.
    const morningPresent = new Set<number>();
    if (shift === 'night') {
      const { data: mDay } = await supabase
        .from('attendance_day')
        .select('id')
        .eq('attendance_date', markDate)
        .eq('shift', 'morning')
        .maybeSingle();
      if (mDay) {
        const { data: mEnt } = await supabase
          .from('attendance_entry')
          .select('employee_id, status')
          .eq('attendance_day_id', (mDay as { id: number }).id)
          .eq('status', 'present');
        for (const row of (mEnt ?? []) as { employee_id: number }[]) {
          morningPresent.add(row.employee_id);
        }
      }
    }

    // Fresh / unmarked employees start on 'present', except:
    //   - their default_shift doesn't match the picked shift  → 'none'
    //   - on Night and they were Present in today's Morning   → 'none'
    const nextStatus: Record<number, AttendanceStatus> = {};
    const nextIn: Record<number, string | null> = {};
    const nextOut: Record<number, string | null> = {};
    const nextShed: Record<number, string | null> = {};
    for (const emp of employees) {
      const stored = statusMap.get(emp.id);
      if (stored !== undefined) {
        nextStatus[emp.id] = stored;
      } else if (shift === 'night' && morningPresent.has(emp.id)) {
        nextStatus[emp.id] = 'none' as AttendanceStatus;
      } else {
        nextStatus[emp.id] = defaultStatusFor(emp, shift);
      }
      nextIn[emp.id] = inMap.get(emp.id) ?? null;
      nextOut[emp.id] = outMap.get(emp.id) ?? null;
      nextShed[emp.id] = shedMap.get(emp.id) ?? null;
    }
    setStatusByEmp(nextStatus);
    setInTimeByEmp(nextIn);
    setOutTimeByEmp(nextOut);
    setShedByEmp(nextShed);
    setLoading(false);
  }, [supabase, employees, markDate, shift]);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  const roles = Array.from(new Set(employees.map((e) => e.role))).sort();
  const visible = employees.filter((e) => roleFilter === 'all' || e.role === roleFilter);

  function setStatus(empId: number, status: AttendanceStatus): void {
    setStatusByEmp((prev) => ({ ...prev, [empId]: status }));
    // Clear in/out times when the status no longer requires them.
    if (!TIME_STATUSES.has(status)) {
      setInTimeByEmp((prev) => ({ ...prev, [empId]: null }));
      setOutTimeByEmp((prev) => ({ ...prev, [empId]: null }));
    }
    // Clear shed when employee did not work this shift.
    if (!WORKED_STATUSES.has(status)) {
      setShedByEmp((prev) => ({ ...prev, [empId]: null }));
    }
    setSavedMsg(null);
  }

  function setShed(empId: number, value: string): void {
    setShedByEmp((prev) => ({ ...prev, [empId]: value || null }));
    setSavedMsg(null);
  }

  function setInTime(empId: number, value: string): void {
    setInTimeByEmp((prev) => ({ ...prev, [empId]: value || null }));
    setSavedMsg(null);
  }
  function setOutTime(empId: number, value: string): void {
    setOutTimeByEmp((prev) => ({ ...prev, [empId]: value || null }));
    setSavedMsg(null);
  }

  function markAllPresent(): void {
    setStatusByEmp((prev) => {
      const next = { ...prev };
      // Only flip employees who are actually scheduled this shift to present;
      // leave 'none' (off-shift) alone so the supervisor doesn't have to
      // re-mark them every time. Compare to 'present' (which is in the
      // generated enum) rather than 'none' (added in migration 029 — not in
      // database.types.ts until regen).
      for (const e of visible) {
        if (defaultStatusFor(e, shift) === 'present') next[e.id] = 'present';
      }
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

  // CORR-A7: if the browser is offline or Supabase fails, stash the payload
  // in localStorage. OfflineSync will replay it when the network returns.
  function stashOffline(reason: string): void {
    const entries = employees.map((emp) => {
      const status = statusByEmp[emp.id] ?? 'present';
      const wantsTime = TIME_STATUSES.has(status);
      const worked = WORKED_STATUSES.has(status);
      return {
        employee_id: String(emp.id),
        status,
        day_weight: 1,
        actual_in_time: wantsTime ? (inTimeByEmp[emp.id] ?? null) : null,
        actual_out_time: wantsTime ? (outTimeByEmp[emp.id] ?? null) : null,
        shed_no: worked ? (shedByEmp[emp.id] ?? null) : null,
      };
    });
    enqueueOffline({
      mark_date: markDate,
      shift,
      entries,
    });
    setPendingCount(queueCount());
    setOfflineMsg(
      `Saved on this device — ${entries.length} employees will sync when the connection returns. (${reason})`,
    );
    window.dispatchEvent(new Event('ppk:queue-changed'));
  }

  async function handleSaveAttendance(): Promise<void> {
    setError(null);
    setSavedMsg(null);
    setOfflineMsg(null);
    if (saveBlocked) {
      setError(editGate.reason);
      return;
    }
    setSaving(true);

    // Hard-offline path — don't even attempt the network call.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      stashOffline('phone is offline');
      setSaving(false);
      return;
    }

    try {
      const dayId = await ensureDay(true);
      if (dayId == null) {
        // ensureDay already surfaced the error. If it was a network problem
        // the user can retry; we don't auto-queue here because we have no
        // day_id yet.
        setSaving(false);
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const rows = employees.map((emp) => {
        const status = statusByEmp[emp.id] ?? 'present';
        const wantsTime = TIME_STATUSES.has(status);
        const worked = WORKED_STATUSES.has(status);
        return {
          attendance_day_id: dayId,
          employee_id: emp.id,
          status,
          actual_in_time: wantsTime ? (inTimeByEmp[emp.id] ?? null) : null,
          actual_out_time: wantsTime ? (outTimeByEmp[emp.id] ?? null) : null,
          shed_no: worked ? (shedByEmp[emp.id] ?? null) : null,
          sync_source: 'online',
          marked_by: user?.id ?? null,
          marked_at: new Date().toISOString(),
        };
      });

      const { error: err } = await supabase
        .from('attendance_entry')
        .upsert(rows as never, { onConflict: 'attendance_day_id,employee_id' });

      setSaving(false);
      if (err) {
        setError(err.message);
        return;
      }
      setSavedMsg(`Saved attendance for ${rows.length} employees.`);
    } catch {
      // Network-level failure (fetch threw). Treat as offline.
      stashOffline('network error');
      setSaving(false);
    }
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

  // Edit-window gate. A day not yet marked (dayMarkedAt == null) is freely
  // editable. Once marked: free < 24h, owner/manager-only 24-168h, locked
  // after 7 days.
  const editGate = canEdit({
    markedAt: dayMarkedAt ?? new Date().toISOString(),
    role: userRole ?? 'floor_operator',
  });
  const editingExisting = dayMarkedAt !== null;
  const saveBlocked = editingExisting && !editGate.allowed;

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
        {offlineMsg && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{offlineMsg}</span>
          </div>
        )}
        {pendingCount > 0 && !offlineMsg && (
          <p className="flex items-center gap-1.5 text-xs text-amber-700">
            <WifiOff className="h-3.5 w-3.5" />
            {pendingCount} pending save{pendingCount === 1 ? '' : 's'} waiting to sync.
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
            {/* Edit-window banner (CORR-A4) */}
            {editingExisting && editGate.window !== 'free' && (
              <div
                className={
                  'flex items-start gap-2 rounded-lg border p-3 text-sm ' +
                  (editGate.allowed
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800')
                }
              >
                <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{editGate.reason}</span>
              </div>
            )}

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
                  {visible.map((emp) => {
                    const empStatus = statusByEmp[emp.id] ?? 'present';
                    const showTimes = TIME_STATUSES.has(empStatus);
                    const showShed = WORKED_STATUSES.has(empStatus);
                    const shedMissing = showShed && !shedByEmp[emp.id];
                    return (
                      <tr key={emp.id} className="border-b border-line/60">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{emp.full_name}</div>
                          <div className="text-xs text-ink-mute capitalize">
                            {emp.code} &middot; {emp.role}
                          </div>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1.5">
                            {STATUSES.map((s) => {
                              const active = empStatus === s.value;
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

                          {showShed && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                              <label className="flex items-center gap-1.5">
                                Shed
                                <select
                                  className={
                                    'input h-9 w-24 text-xs ' +
                                    (shedMissing
                                      ? 'border-rose-300 bg-rose-50 text-rose-700'
                                      : '')
                                  }
                                  value={shedByEmp[emp.id] ?? ''}
                                  onChange={(e) => setShed(emp.id, e.target.value)}
                                >
                                  <option value="">— pick —</option>
                                  {SHEDS.map((s) => (
                                    <option key={s} value={s}>
                                      Shed {s}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              {shedMissing && (
                                <span className="text-[10px] text-rose-600">
                                  Required for wage allocation
                                </span>
                              )}
                            </div>
                          )}

                          {showTimes && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-mute">
                              <label className="flex items-center gap-1.5">
                                In
                                <input
                                  type="time"
                                  className="input h-9 w-28 text-xs"
                                  value={inTimeByEmp[emp.id] ?? ''}
                                  onChange={(e) => setInTime(emp.id, e.target.value)}
                                />
                              </label>
                              <label className="flex items-center gap-1.5">
                                Out
                                <input
                                  type="time"
                                  className="input h-9 w-28 text-xs"
                                  value={outTimeByEmp[emp.id] ?? ''}
                                  onChange={(e) => setOutTime(emp.id, e.target.value)}
                                />
                              </label>
                              <span className="text-[10px] text-ink-mute">
                                {empStatus === 'late' && 'Actual arrival time'}
                                {empStatus === 'early_leave' && 'Actual leave time'}
                                {empStatus === 'half_day' && 'Half-shift in/out'}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                className="btn-primary flex items-center gap-1.5 min-h-[44px]"
                onClick={handleSaveAttendance}
                disabled={saving || loading || saveBlocked}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save attendance
              </button>
              <span className="text-xs text-ink-mute">
                {saveBlocked
                  ? 'Editing is closed for this date and shift.'
                  : 'Saving again overwrites the earlier entry for this date and shift.'}
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
