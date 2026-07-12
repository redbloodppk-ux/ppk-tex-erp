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
  source_ledger_id?: number | null;
  loan_deduction?: number | null;
}

// An "Advance" wage entry paid to the employee inside the selected
// settlement week — surfaced so the operator can net it off the amount.
interface WeekAdvanceRow {
  id: number;
  pay_date: string;
  amount: number;
  notes: string | null;
}

// Cash / bank account the wage was paid from.
interface SourceLedgerOption {
  id: number;
  name: string;
  type_name: string;
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
  // For "Weekly settlement" kind only: the operator picks which Mon-Sun
  // week the payment is being applied to. Stays independent of pay_date so
  // you can record a payment made *today* against last week (or any other
  // week). On edit we hydrate it from the row's period_start.
  const [settlementWeekMonday, setSettlementWeekMonday] = useState<string>(
    initial?.kind === 'settlement' && initial.period_start
      ? initial.period_start
      : currentWeekMondayISO(),
  );
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : '');
  const [notes, setNotes] = useState<string>(initial?.notes ?? '');

  // Loan repayment withheld from this wage. The cash actually handed over is
  // (amount - loanDeduction); the withheld part reduces the worker's
  // outstanding employee_loan balance.
  const [loanDeduction, setLoanDeduction] = useState<string>(
    initial?.loan_deduction != null && initial.loan_deduction > 0 ? String(initial.loan_deduction) : '',
  );
  // The employee's outstanding loan (total disbursed - total already repaid),
  // shown beside the Loan repayment field so the operator knows the cap.
  const [outstandingLoan, setOutstandingLoan] = useState<number | null>(null);

  // "Paid from" cash/bank account. Defaults to CASH once the list loads.
  const [sourceLedgers, setSourceLedgers] = useState<SourceLedgerOption[]>([]);
  const [sourceLedgerId, setSourceLedgerId] = useState<string>(
    initial?.source_ledger_id != null ? String(initial.source_ledger_id) : '',
  );

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Load active cash + bank ledgers for the "Paid from" picker.
  useEffect(() => {
    let cancelled = false;
    async function loadLedgers(): Promise<void> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('ledger')
        .select('id, name, active, ledger_type:type_id ( name )')
        .eq('active', true)
        .order('name');
      if (cancelled) return;
      const list = ((data ?? []) as Array<{ id: number; name: string; ledger_type: { name: string } | null }>)
        .filter((r) => r.ledger_type?.name === 'CASH' || r.ledger_type?.name === 'BANK')
        .map((r) => ({ id: r.id, name: r.name, type_name: r.ledger_type?.name ?? '' }))
        // CASH first, then banks alphabetically.
        .sort((a, b) => (a.type_name === b.type_name ? a.name.localeCompare(b.name) : a.type_name === 'CASH' ? -1 : 1));
      setSourceLedgers(list);
      // Default selection: keep the edit value if present, else first CASH.
      if (!sourceLedgerId) {
        const cash = list.find((l) => l.type_name === 'CASH') ?? list[0];
        if (cash) setSourceLedgerId(String(cash.id));
      }
    }
    void loadLedgers();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase]);

  // Outstanding loan for the selected employee = SUM(employee_loan.amount) −
  // SUM(wage_entry.loan_deduction). When editing, exclude this row's own
  // existing deduction so the figure reflects the balance before this wage.
  useEffect(() => {
    let cancelled = false;
    async function loadOutstanding(): Promise<void> {
      if (!employeeId) {
        setOutstandingLoan(null);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: loans } = await (supabase as any)
        .from('employee_loan')
        .select('amount')
        .eq('employee_id', Number(employeeId));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: deds } = await (supabase as any)
        .from('wage_entry')
        .select('id, loan_deduction')
        .eq('employee_id', Number(employeeId));
      if (cancelled) return;
      const disbursed = ((loans ?? []) as Array<{ amount: number }>)
        .reduce((acc, r) => acc + Number(r.amount || 0), 0);
      const repaid = ((deds ?? []) as Array<{ id: number; loan_deduction: number | null }>)
        .filter((r) => !(isEdit && initial && r.id === initial.id))
        .reduce((acc, r) => acc + Number(r.loan_deduction || 0), 0);
      setOutstandingLoan(disbursed - repaid);
    }
    void loadOutstanding();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, employeeId]);

  // Advances paid to this employee during the selected settlement week
  // (pay_date inside Mon–Sun). Shown on Weekly settlement so the operator
  // remembers to deduct them from the amount being paid out now.
  const [weekAdvances, setWeekAdvances] = useState<WeekAdvanceRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function loadWeekAdvances(): Promise<void> {
      if (!employeeId || kind !== 'settlement' || !periodStart || !periodEnd) {
        setWeekAdvances([]);
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from('wage_entry')
        .select('id, pay_date, amount, notes')
        .eq('employee_id', Number(employeeId))
        .eq('kind', 'advance')
        .gte('pay_date', periodStart)
        .lte('pay_date', periodEnd)
        .order('pay_date');
      if (cancelled) return;
      setWeekAdvances(((data ?? []) as WeekAdvanceRow[]));
    }
    void loadWeekAdvances();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, employeeId, kind, periodStart, periodEnd]);
  const weekAdvanceTotal = weekAdvances.reduce((s, a) => s + Number(a.amount || 0), 0);

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

  // Period is derived from either the slider (when kind = settlement) or
  // the Pay date (every other kind). Both date pickers stay disabled — the
  // operator can only move the period via the slider or pay-date input.
  //
  // For "Weekly settlement" specifically: Pay date is the *actual* day the
  // money changes hands and is independent of the chosen week. So a payment
  // made today (Wed) for last week's wages records pay_date = today but
  // period = last Mon-Sun. The wage will only appear in last week's summary.
  useEffect(() => {
    if (kind === 'settlement') {
      setPeriodStart(settlementWeekMonday);
      setPeriodEnd(weekSundayFor(settlementWeekMonday));
    } else {
      setPeriodStart(weekMondayFor(payDate));
      setPeriodEnd(weekSundayFor(payDate));
    }
  }, [kind, payDate, settlementWeekMonday]);

  // -------- Week slider (visible only on Weekly settlement) --------
  // Scrubs the selected settlement week in 1-week jumps. Pay date stays
  // independent — it records *when* the payment was made, not which week
  // it applies to. Slider value is "weeks from today's ISO week"
  // (0 = this week, -1 = last week, +1 = next week ...).
  const todayMondayISO = useMemo<string>(() => weekMondayFor(todayISO()), []);
  const weekOffset = useMemo<number>(() => {
    const a = Date.parse(settlementWeekMonday + 'T00:00:00Z');
    const b = Date.parse(todayMondayISO + 'T00:00:00Z');
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    return Math.round((a - b) / (7 * 86_400_000));
  }, [settlementWeekMonday, todayMondayISO]);

  function shiftSettlementWeekByDays(deltaDays: number): void {
    const [y, m, d] = settlementWeekMonday.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + deltaDays);
    setSettlementWeekMonday(dt.toISOString().slice(0, 10));
  }

  function setWeekOffsetTo(target: number): void {
    shiftSettlementWeekByDays((target - weekOffset) * 7);
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
      for (const r of atts) {
        const sh = r.attendance_day?.shift;
        if (sh === 'morning') morning += 1;
        if (sh === 'night') night += 1;
        if (r.shed_no) {
          shedSet.add(r.shed_no);
        } else {
          missingSheds += 1;
        }
      }

      // 2) For metre-basis weavers, prefill the amount from the metres THIS
      //    employee logged on the Shift Log (production_shift_log_weaver),
      //    priced at the shift log's rate_per_m when set, else the loom's
      //    default ₹/m. No shed matching needed — the metres are already
      //    attributed to the weaver on the log itself.
      let autoAmount: number | null = null;
      let autoNote: string | null = null;
      if (selected?.wage_alloc_basis === 'metres') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: prodRows } = await (supabase as any)
          .from('production_shift_log_weaver')
          .select(
            'metres_woven, shift_log:shift_log_id!inner ( log_date, rate_per_m, loom:loom_id ( default_rate_per_m ) )',
          )
          .eq('employee_id', Number(employeeId))
          .gte('shift_log.log_date', periodStart)
          .lte('shift_log.log_date', periodEnd);

        type ProdRow = {
          metres_woven: number | null;
          shift_log: {
            log_date: string;
            rate_per_m: number | null;
            loom: { default_rate_per_m: number | null } | null;
          } | null;
        };
        let total = 0;
        let metresCounted = 0;
        let missingRate = false;
        for (const r of (prodRows ?? []) as ProdRow[]) {
          const metres = Number(r.metres_woven ?? 0);
          if (!metres) continue;
          const rate =
            Number(r.shift_log?.rate_per_m ?? 0) ||
            Number(r.shift_log?.loom?.default_rate_per_m ?? 0);
          if (!rate) {
            missingRate = true;
            continue;
          }
          total += metres * rate;
          metresCounted += metres;
        }
        autoAmount = Math.round(total * 100) / 100;
        autoNote = missingRate
          ? `From ${metresCounted} m woven by this employee in the period. Some looms have no ₹/m rate — set it on Settings → Looms.`
          : `From ${metresCounted} m woven by this employee in the period × ₹/m rate.`;
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
    const loanDed = loanDeduction === '' ? 0 : Number(loanDeduction);
    if (!Number.isFinite(loanDed) || loanDed < 0) {
      setError('Loan repayment must be a non-negative number.');
      return;
    }
    if (loanDed > amt) {
      setError('Loan repayment cannot be more than the wage amount.');
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
      source_ledger_id: sourceLedgerId ? Number(sourceLedgerId) : null,
      loan_deduction: loanDed,
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

      <div>
        <label className="label" htmlFor="sourceLedger">Paid from</label>
        <select
          id="sourceLedger"
          className="input"
          value={sourceLedgerId}
          onChange={(e) => setSourceLedgerId(e.target.value)}
        >
          {sourceLedgers.length === 0 && <option value="">Loading…</option>}
          {sourceLedgers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}{l.type_name === 'CASH' ? '' : ' (Bank)'}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-1">
          Which account this wage was paid from. It records a matching Credit on
          that cash/bank ledger so its balance reflects money going out.
        </p>
      </div>

      <div>
        <label className="label" htmlFor="loanDeduction">Loan repayment (₹)</label>
        <input
          id="loanDeduction"
          type="number"
          inputMode="decimal"
          step="1"
          min="0"
          className="input num"
          value={loanDeduction}
          onChange={(e) => setLoanDeduction(e.target.value)}
          placeholder="0"
        />
        <p className="text-[11px] text-ink-mute mt-1">
          {outstandingLoan != null && outstandingLoan > 0 ? (
            <>
              Outstanding loan for this worker:{' '}
              <span className="font-semibold text-rose-700">₹{outstandingLoan.toFixed(2)}</span>.{' '}
            </>
          ) : outstandingLoan != null ? (
            <>This worker has no outstanding loan. </>
          ) : null}
          Amount withheld from this wage to repay their loan. Cash actually paid =
          Amount − Loan repayment ={' '}
          <span className="font-semibold num">
            ₹{Math.max(0, (Number(amount) || 0) - (Number(loanDeduction) || 0)).toFixed(2)}
          </span>
          . Issue new loans on the{' '}
          <Link href="/app/loans" className="text-indigo font-semibold">Loans</Link> page.
        </p>
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
              onClick={() => shiftSettlementWeekByDays(-7)}
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
              onClick={() => shiftSettlementWeekByDays(7)}
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
              This week
            </button>
          </div>
          <p className="text-[10px] text-ink-mute">
            Slide to pick which week this payment covers. <strong>Pay date</strong> records when
            you actually paid — it stays independent. The wage will show up in the selected
            week&apos;s summary only.
          </p>
          {weekAdvances.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" />
                Advance paid during this week — remember to deduct it
              </div>
              {weekAdvances.map((a) => (
                <div key={a.id} className="flex items-center justify-between text-xs text-amber-900">
                  <span>
                    {fmtShortDate(a.pay_date)}
                    {a.notes ? <span className="text-amber-700"> — {a.notes}</span> : null}
                  </span>
                  <span className="font-semibold num">₹{Number(a.amount || 0).toFixed(2)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t border-amber-200 pt-1 text-xs font-bold text-amber-900">
                <span>Total advance this week</span>
                <span className="num">₹{weekAdvanceTotal.toFixed(2)}</span>
              </div>
            </div>
          )}
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
        {kind === 'settlement'
          ? 'Pay date = actual payment date. Period (Mon–Sun) follows the Week selector above, so the wage lands in that week\u2019s summary regardless of when you paid.'
          : 'Period auto-fills to the ISO week (Mon–Sun) containing the Pay date. Move the Pay date to slide the window.'}
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
