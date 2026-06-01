'use client';
/**
 * WageEntryForm — single wage_entry row entry (CORR-T4)
 *
 * Per-employee allocation basis (metres vs loom_shifts) is set on the
 * Employee form, not here. We surface the current value in the helper text
 * so the operator knows which way this entry will spread.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Info, AlertTriangle } from 'lucide-react';

export type Kind = 'same_day' | 'advance' | 'settlement' | 'adjustment';

// Read-only context the form fetches after employee + period are set.
// It tells the operator which shifts the employee was actually marked
// present for and which sheds had production in the window — i.e. where
// the wage will end up allocating.
interface WorkContext {
  shifts: { morning: number; night: number };
  sheds: string[];
  // How many of the employee's attendance entries are missing a shed pick.
  // When > 0 the operator must go back to attendance/mark to set them so the
  // metre-basis wage knows which loom output applies.
  missingSheds: number;
  // For metre-basis weavers — total metres × per-loom rate over the period.
  // Used to prefill Amount; the operator can still override.
  autoAmount: number | null;
  autoAmountNote: string | null;
  loading: boolean;
  fetched: boolean;
}

export interface EmployeeOption {
  id: number;
  code: string;
  full_name: string;
  role: string;
  wage_alloc_basis: 'metres' | 'loom_shifts' | 'weekly';
  // Salaried staff and others flagged not-attendance-required skip the
  // attendance/shed lookup entirely on this form.
  attendance_required?: boolean | null;
  // For weekly-basis employees this auto-fills the amount when kind = settlement.
  weekly_salary?: number | null;
}

// Optional starting values — when provided, the form switches to "edit"
// mode and PATCHes the existing wage_entry row instead of inserting a
// new one.
export interface InitialEntry {
  id: number;
  employee_id: number;
  pay_date: string;
  period_start: string;
  period_end: string;
  kind: Kind;
  amount: number;
  notes: string | null;
}

interface WageEntryFormProps {
  employees: EmployeeOption[];
  initial?: InitialEntry;
}

function todayISO(): string {
  // Use the local calendar date (IST) instead of UTC, otherwise late
  // evening / early morning IST would default to the wrong day.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Use UTC throughout so timezones (IST is +05:30) don't shift the result
// to the previous day when we call toISOString(). Parsing the local-time
// "YYYY-MM-DD" string and then formatting back via toISOString was making
// Mon-Sun render as Sun-Sat in India.
function weekMondayFor(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat
  const offset = day === 0 ? -6 : 1 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function weekSundayFor(dateISO: string): string {
  const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay();
  const offset = day === 0 ? 0 : 7 - day;
  dt.setUTCDate(dt.getUTCDate() + offset);
  return dt.toISOString().slice(0, 10);
}

function currentWeekMondayISO(): string {
  return weekMondayFor(todayISO());
}

function currentWeekSundayISO(): string {
  return weekSundayFor(todayISO());
}

export function WageEntryForm({ employees, initial }: WageEntryFormProps): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const isEdit = initial != null;

  const [employeeId, setEmployeeId] = useState<string>(
    initial ? String(initial.employee_id) : employees[0] ? String(employees[0].id) : '',
  );
  const [payDate, setPayDate] = useState<string>(initial?.pay_date ?? todayISO());
  const [periodStart, setPeriodStart] = useState<string>(initial?.period_start ?? currentWeekMondayISO());
  const [periodEnd, setPeriodEnd] = useState<string>(initial?.period_end ?? currentWeekSundayISO());
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'settlement');
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : '');
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [ctx, setCtx] = useState<WorkContext>({
    shifts: { morning: 0, night: 0 },
    sheds: [],
    missingSheds: 0,
    autoAmount: null,
    autoAmountNote: null,
    loading: false,
    fetched: false,
  });
  // Tracks whether the amount currently shown was prefilled by the auto-calc.
  // If yes, recomputing the context updates it; if the operator typed something
  // of their own, leave it alone.
  const autoFilledRef = useRef<boolean>(false);

  const selected = useMemo(
    () => employees.find((e) => String(e.id) === employeeId) ?? null,
    [employees, employeeId],
  );

  // Metre-basis weavers: wages are derived from a date range of shift-log
  // production matched to attendance shift+shed. A single-day "Same day"
  // payment doesn't make sense here, so we hide it and force the period
  // pickers to stay enabled.
  const isWeaver = selected?.role.toLowerCase() === 'weaver';
  const isMetreBasis = selected?.wage_alloc_basis === 'metres';
  // Weekly-basis employees: paid a fixed weekly book salary. Same-day doesn't
  // apply (they get settled weekly); the amount on a "settlement" auto-fills
  // from employee.weekly_salary.
  const isWeekly = selected?.wage_alloc_basis === 'weekly';
  // Salaried / non-attendance employees skip the attendance + shed lookup
  // entirely — they don't have daily marks to read from.
  const attendanceRequired = selected ? selected.attendance_required !== false : true;
  // EVERY wage_entry — regardless of kind or employee basis — uses the ISO
  // week (Mon-Sun) containing the Pay date as its period. Both date pickers
  // are always disabled. The operator can only move the window by changing
  // the Pay date, which keeps attendance + production lookup honest.

  // If the employee changes to a metre-basis weaver or a weekly-basis employee
  // while Kind is "same_day", bump it to settlement so the date range is
  // available (metres) or the weekly auto-fill applies (weekly).
  useEffect(() => {
    if ((isMetreBasis || isWeekly) && kind === 'same_day') {
      setKind('settlement');
    }
  }, [isMetreBasis, isWeekly, kind]);

  // For weekly-basis employees on a settlement entry, prefill the amount from
  // employee.weekly_salary. Same auto-fill semantics as the metres branch:
  // never clobber a value the operator typed.
  useEffect(() => {
    if (!isWeekly) return;
    if (kind !== 'settlement') return;
    const ws = selected?.weekly_salary;
    if (ws == null) return;
    if (amount === '' || autoFilledRef.current) {
      setAmount(String(ws));
      autoFilledRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeekly, kind, selected]);

  // The period is ALWAYS derived from the Pay date — both date pickers are
  // disabled. Mon = start of the ISO week containing the Pay date, Sun = end.
  // Applies to every kind (same_day / advance / settlement / adjustment) and
  // every basis (metres / loom_shifts / weekly), so the attendance and
  // production lookup always covers the full week the wage belongs to.
  useEffect(() => {
    setPeriodStart(weekMondayFor(payDate));
    setPeriodEnd(weekSundayFor(payDate));
  }, [payDate]);

  // -------- Week slider (visible only on Weekly settlement) --------
  // Lets the operator scrub the Pay date in 1-week jumps using a range
  // input + prev / next chevrons. Slider value is "weeks from today's
  // ISO week" (0 = this week, -1 = last week, +1 = next week ...).
  const todayMondayISO = useMemo<string>(() => weekMondayFor(todayISO()), []);
  const currentMondayISO = useMemo<string>(() => weekMondayFor(payDate), [payDate]);
  const weekOffset = useMemo<number>(() => {
    const a = Date.parse(currentMondayISO + 'T00:00:00Z');
    const b = Date.parse(todayMondayISO + 'T00:00:00Z');
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((a - b) / (7 * 86_400_000));
  }, [currentMondayISO, todayMondayISO]);

  function shiftPayDateByDays(deltaDays: number): void {
    const [y, m, d] = payDate.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + deltaDays);
    setPayDate(dt.toISOString().slice(0, 10));
  }

  function setWeekOffsetTo(target: number): void {
    shiftPayDateByDays((target - weekOffset) * 7);
  }

  function fmtShortDate(dateISO: string): string {
    if (!dateISO) return '-';
    const [y, m, d] = dateISO.split('-').map(Number) as [number, number, number];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return String(d).padStart(2, '0') + '-' + months[m - 1];
  }

  // Fetch shifts worked + sheds active for the chosen employee in the
  // chosen period. Surfaced read-only above the Save button so the operator
  // sees which sheds/shifts the wage will allocate to.
  useEffect(() => {
    if (!employeeId || !periodStart || !periodEnd) return;
    if (periodEnd < periodStart) return;
    // Skip the whole context lookup for non-attendance employees.
    if (!attendanceRequired) {
      setCtx({
        shifts: { morning: 0, night: 0 },
        sheds: [],
        missingSheds: 0,
        autoAmount: null,
        autoAmountNote: null,
        loading: false,
        fetched: false,
      });
      return;
    }
    let cancelled = false;

    async function loadContext(): Promise<void> {
      setCtx((c) => ({ ...c, loading: true }));

      // 1) Pull the employee's attendance entries in the window.
      //
      //    We do this in TWO queries (one for attendance_day in the period,
      //    one for attendance_entry by those day IDs) instead of a single
      //    embedded select with `.gte('attendance_day.attendance_date', ...)`.
      //    PostgREST's embedded-filter semantics are left-join based: when
      //    the date filter rejects the day, the outer attendance_entry row
      //    still comes back with `attendance_day = null`, but in some setups
      //    Supabase returns zero rows at all — which made us report
      //    "No attendance found" for employees who DID have an entry.
      //    Two small queries is reliable across schemas and RLS policies.

      type DayRow = {
        id: number;
        shift: string;
        attendance_date: string;
        is_working: boolean | null;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: dayRows } = await (supabase as any)
        .from('attendance_day')
        .select('id, shift, attendance_date, is_working')
        .gte('attendance_date', periodStart)
        .lte('attendance_date', periodEnd);

      const days = (dayRows ?? []) as DayRow[];
      const dayMap = new Map<number, DayRow>();
      for (const d of days) dayMap.set(d.id, d);
      const dayIds = days.map((d) => d.id);

      type AttRow = {
        shed_no: string | null;
        status: string;
        attendance_day: { shift: string; attendance_date: string } | null;
      };
      const atts: AttRow[] = [];
      if (dayIds.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: entRows } = await (supabase as any)
          .from('attendance_entry')
          .select('attendance_day_id, shed_no, status')
          .eq('employee_id', Number(employeeId))
          .in('status', ['present', 'half_day', 'late', 'early_leave'])
          .in('attendance_day_id', dayIds);
        type RawEnt = {
          attendance_day_id: number;
          shed_no: string | null;
          status: string;
        };
        for (const r of (entRows ?? []) as RawEnt[]) {
          const d = dayMap.get(r.attendance_day_id);
          if (!d) continue;
          atts.push({
            shed_no: r.shed_no,
            status: r.status,
            attendance_day: { shift: d.shift, attendance_date: d.attendance_date },
          });
        }
      }

      let morning = 0;
      let night = 0;
      const shedSet = new Set<string>();
      let missingSheds = 0;
      // (date, shift) -> shed_no — used below to match production logs.
      const shedByDateShift = new Map<string, string>();
      for (const r of atts) {
        const sh = r.attendance_day?.shift;
        if (sh === 'morning') morning += 1;
        if (sh === 'night') night += 1;
        if (r.shed_no) {
          shedSet.add(r.shed_no);
          shedByDateShift.set(
            `${r.attendance_day?.attendance_date}|${sh}`,
            r.shed_no,
          );
        } else {
          missingSheds += 1;
        }
      }

      // 2) For metre-basis weavers, prefill the amount from the shift-log
      //    production × per-loom default rate, scoped to looms whose shed
      //    matches the employee's attendance shed on the same (date, shift).
      let autoAmount: number | null = null;
      let autoNote: string | null = null;
      if (
        selected?.wage_alloc_basis === 'metres' &&
        atts.length > 0 &&
        missingSheds === 0
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: prodRows } = await (supabase as any)
          .from('production_shift_log')
          .select(
            'log_date, shift, produced_m, loom:loom_id ( shed_no, default_rate_per_m )',
          )
          .gte('log_date', periodStart)
          .lte('log_date', periodEnd);

        type ProdRow = {
          log_date: string;
          shift: string;
          produced_m: number | null;
          loom: { shed_no: string | null; default_rate_per_m: number | null } | null;
        };
        let total = 0;
        let metresCounted = 0;
        let missingRate = false;
        for (const r of (prodRows ?? []) as ProdRow[]) {
          const empShed = shedByDateShift.get(`${r.log_date}|${r.shift}`);
          if (!empShed) continue;
          if (r.loom?.shed_no !== empShed) continue;
          const metres = Number(r.produced_m ?? 0);
          const rate = Number(r.loom?.default_rate_per_m ?? 0);
          if (!rate) {
            missingRate = true;
            continue;
          }
          total += metres * rate;
          metresCounted += metres;
        }
        autoAmount = Math.round(total * 100) / 100;
        autoNote = missingRate
          ? `From ${metresCounted} m of matched production. Some looms have no default ₹/m — set it on Settings → Looms.`
          : `From ${metresCounted} m of matched production × per-loom default ₹/m.`;
      }

      if (cancelled) return;
      setCtx({
        shifts: { morning, night },
        sheds: Array.from(shedSet).sort(),
        missingSheds,
        autoAmount,
        autoAmountNote: autoNote,
        loading: false,
        fetched: true,
      });
    }

    void loadContext();
    return () => {
      cancelled = true;
    };
  }, [supabase, employeeId, periodStart, periodEnd, selected, attendanceRequired]);

  // Auto-prefill Amount for metre-basis weavers whenever the context produces
  // a number — but never clobber a value the operator typed themselves.
  useEffect(() => {
    if (!ctx.fetched) return;
    if (ctx.autoAmount == null) return;
    if (amount === '' || autoFilledRef.current) {
      setAmount(String(ctx.autoAmount));
      autoFilledRef.current = true;
    }
    // We intentionally exclude `amount` from deps so the user's keystrokes
    // don't trigger another prefill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.autoAmount, ctx.fetched]);

  function handleAmountChange(value: string): void {
    autoFilledRef.current = false;
    setAmount(value);
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!employeeId) {
      setError('Pick an employee.');
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setError('Amount must be a non-negative number.');
      return;
    }
    if (periodEnd < periodStart) {
      setError('Period end cannot be before period start.');
      return;
    }
    if (attendanceRequired && isWeaver && ctx.fetched && ctx.missingSheds > 0) {
      setError(
        `Pick a shed for every shift this weaver worked (${ctx.missingSheds} missing). Open Attendance → Mark and assign sheds for the period.`,
      );
      return;
    }

    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    // wage_entry was added in migration 031 — types not yet regenerated.
    const payload = {
      employee_id: Number(employeeId),
      pay_date: payDate,
      period_start: periodStart,
      period_end: periodEnd,
      kind,
      amount: amt,
      notes: notes.trim() || null,
      updated_by: user?.id ?? null,
    };

    let insErr: { message: string } | null = null;
    if (isEdit && initial) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('wage_entry')
        .update(payload as never)
        .eq('id', initial.id);
      insErr = error ?? null;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('wage_entry')
        .insert([{ ...payload, created_by: user?.id ?? null } as never]);
      insErr = error ?? null;
    }

    setBusy(false);

    if (insErr) {
      setError(insErr.message);
      return;
    }
    router.push('/app/wages');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-xl">
      <div>
        <label className="label" htmlFor="employee">Employee</label>
        <select
          id="employee"
          className="input"
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          required
        >
          {employees.length === 0 && <option value="">No active employees</option>}
          {employees.map((emp) => (
            <option key={emp.id} value={emp.id}>
              {emp.code} — {emp.full_name} ({emp.role})
            </option>
          ))}
        </select>
        {selected && (
          <p className="text-[11px] text-ink-mute mt-1">
            Allocation basis for this employee:{' '}
            <span className="font-semibold capitalize">
              {selected.wage_alloc_basis.replace('_', '-')}
            </span>
            . Change on the Employee page if needed.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="kind">Kind</label>
          <select
            id="kind"
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {!isMetreBasis && !isWeekly && <option value="same_day">Same day</option>}
            <option value="settlement">Weekly settlement</option>
            <option value="advance">Advance</option>
            <option value="adjustment">Adjustment</option>
          </select>
          {(isMetreBasis || isWeekly) && (
            <p className="text-[11px] text-ink-mute mt-1">
              {isMetreBasis
                ? 'Metre-basis weavers are paid against a date range — Same day is not available.'
                : 'Weekly-basis staff are paid a fixed weekly book salary — Same day is not available.'}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="amount">Amount (₹)</label>
          <input
            id="amount"
            type="number"
            inputMode="decimal"
            step="1"
            min="0"
            className="input num"
            value={amount}
            onChange={(e) => handleAmountChange(e.target.value)}
            required
          />
        </div>
      </div>

      {kind === 'settlement' && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="label text-xs mb-0" htmlFor="weekSlider">Week selector</label>
            <div className="text-xs font-semibold text-ink-soft">
              <span className="text-indigo-700">
                {fmtShortDate(periodStart)} – {fmtShortDate(periodEnd)}
              </span>
              {weekOffset === 0 && (
                <span className="ml-2 text-emerald-700">(this week)</span>
              )}
              {weekOffset === -1 && (
                <span className="ml-2 text-amber-700">(last week)</span>
              )}
              {weekOffset !== 0 && weekOffset !== -1 && (
                <span className="ml-2 text-ink-mute">
                  ({weekOffset > 0 ? '+' : ''}{weekOffset} wk)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => shiftPayDateByDays(-7)}
              className="h-8 w-8 rounded border border-line bg-white text-ink-soft hover:bg-cloud font-bold"
              title="Previous week"
              aria-label="Previous week"
            >
              ‹
            </button>
            <input
              id="weekSlider"
              type="range"
              min={-26}
              max={4}
              step={1}
              value={weekOffset > 4 ? 4 : weekOffset < -26 ? -26 : weekOffset}
              onChange={(e) => setWeekOffsetTo(Number(e.target.value))}
              className="flex-1 accent-indigo-600"
            />
            <button
              type="button"
              onClick={() => shiftPayDateByDays(7)}
              className="h-8 w-8 rounded border border-line bg-white text-ink-soft hover:bg-cloud font-bold"
              title="Next week"
              aria-label="Next week"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setWeekOffsetTo(0)}
              className="h-8 px-2 rounded border border-line bg-white text-ink-soft hover:bg-cloud text-xs font-semibold"
              title="Jump to current week"
            >
              Today
            </button>
          </div>
          <p className="text-[10px] text-ink-mute">
            Slide to pick a week. Pay date and Period auto-update to the Mon–Sun range you choose.
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="payDate">Pay date</label>
          <input
            id="payDate"
            type="date"
            className="input"
            value={payDate}
            onChange={(e) => setPayDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="periodStart">Period start</label>
          <input
            id="periodStart"
            type="date"
            className="input disabled:bg-cloud/40 disabled:text-ink-mute"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            disabled
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="periodEnd">Period end</label>
          <input
            id="periodEnd"
            type="date"
            className="input disabled:bg-cloud/40 disabled:text-ink-mute"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            disabled
            required
          />
        </div>
      </div>
      <p className="text-[11px] text-ink-mute -mt-2">
        Period auto-fills to the ISO week (Mon–Sun) containing the Pay date. Move the Pay date to slide the window.
      </p>

      <div>
        <label className="label" htmlFor="notes">Notes (optional)</label>
        <textarea
          id="notes"
          className="input min-h-[64px]"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. weekly settlement, festival bonus, deduction reversal"
        />
      </div>

      {/* Read-only work-context: which shifts the employee actually worked and
          which sheds had production in this period. Surfaced so the operator
          confirms the allocation target before saving. */}
      {employeeId && !attendanceRequired && (
        <div className="rounded-lg border border-line bg-cloud/30 p-3 text-xs text-ink-mute">
          This employee is not on the daily attendance roster — wages are
          entered directly, no shift/shed lookup needed.
        </div>
      )}

      {employeeId && attendanceRequired && (
        <div className="rounded-lg border border-line bg-cloud/30 p-3 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-ink-soft">
            <Info className="w-3.5 h-3.5" />
            Where this wage will allocate
          </div>
          {ctx.loading ? (
            <div className="text-ink-mute">Checking attendance and production…</div>
          ) : !ctx.fetched ? (
            <div className="text-ink-mute">Pick a period to load the context.</div>
          ) : (
            <>
              <div>
                <span className="text-ink-mute">Shifts worked:</span>{' '}
                {ctx.shifts.morning === 0 && ctx.shifts.night === 0 ? (
                  <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    No attendance found in this period.
                    <Link
                      href={`/app/attendance/mark?from=${periodStart}&to=${periodEnd}`}
                      className="underline text-rose-700 hover:text-rose-900"
                    >
                      → Mark attendance
                    </Link>
                  </span>
                ) : (
                  <span className="font-medium">
                    {ctx.shifts.morning > 0 && `Morning × ${ctx.shifts.morning}`}
                    {ctx.shifts.morning > 0 && ctx.shifts.night > 0 && ' · '}
                    {ctx.shifts.night > 0 && `Night × ${ctx.shifts.night}`}
                  </span>
                )}
              </div>
              {isWeaver && (
              <div>
                <span className="text-ink-mute">Sheds picked:</span>{' '}
                {ctx.sheds.length === 0 && ctx.missingSheds === 0 ? (
                  <span className="text-ink-mute">—</span>
                ) : ctx.missingSheds > 0 ? (
                  <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {ctx.missingSheds} shift{ctx.missingSheds === 1 ? '' : 's'} missing a shed pick.
                    <Link
                      href={`/app/attendance/mark?from=${periodStart}&to=${periodEnd}`}
                      className="underline text-rose-700 hover:text-rose-900"
                    >
                      → Pick sheds
                    </Link>
                  </span>
                ) : (
                  <span className="font-medium">{ctx.sheds.join(', ')}</span>
                )}
              </div>
              )}
              {ctx.autoAmount != null && (
                <div className="pt-1 text-emerald-700">
                  Auto-filled amount: ₹
                  <span className="font-semibold num">{ctx.autoAmount.toFixed(2)}</span>
                  {ctx.autoAmountNote && (
                    <span className="block text-[11px] text-ink-mute pt-0.5">
                      {ctx.autoAmountNote} You can override the amount above.
                    </span>
                  )}
                </div>
              )}
              <p className="text-[11px] text-ink-mute pt-0.5">
                This is read-only. The pro-rata allocation runs automatically
                from this period and the employee&apos;s basis.
              </p>
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy || employees.length === 0}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Save wage entry'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push('/app/wages')}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
