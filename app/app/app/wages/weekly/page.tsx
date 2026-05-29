/**
 * Weekly wages summary (migration 037)
 *
 * Server component. Picks a week (defaults to current Monday) and shows:
 *   - Totals: wages, advances, adjustments, same-day, expenses, net cash out
 *   - Per weekly-basis employee: book salary, advances taken, adjustments,
 *     net payable for the week
 *   - Raw wage_entry + expense_entry rows in the picked window
 *
 * A Save-snapshot button writes the rendered payload into
 * weekly_wage_summary keyed by (fy_label, week_no).
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import { ChevronLeft, ChevronRight, Archive } from 'lucide-react';
import { SaveSnapshotForm } from './save-snapshot-form';
import { ExportButtons } from './export-buttons';

export const metadata = { title: 'Weekly Wage Summary' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ week?: string }>;
}

type Kind = 'same_day' | 'advance' | 'settlement' | 'adjustment';

interface WageRow {
  id: number;
  employee_id: number;
  pay_date: string;
  period_start: string;
  period_end: string;
  kind: Kind;
  amount: number;
  notes: string | null;
}

interface ExpenseRow {
  id: number;
  category: string;
  pay_date: string;
  amount: number;
  notes: string | null;
}

interface EmployeeRow {
  id: number;
  full_name: string;
  code: string;
  role: string;
  wage_alloc_basis: 'metres' | 'loom_shifts' | 'weekly';
  weekly_salary: number | string | null;
}

interface FyWeekRow {
  fy_label: string;
  week_no: number;
  week_start: string;
  week_end: string;
}

interface PerEmployee {
  employee_id: number;
  code: string;
  full_name: string;
  role: string;
  book_salary: number;       // pro-rated weekly salary (after absent deduction for fitter, after weaver-absence deduction for winder)
  full_salary: number;       // original weekly_salary before deduction
  absent_days: number;       // distinct absent dates within the week (fitter only)
  absent_deduction: number;  // full_salary - book_salary
  // Winder-specific fields (empty for fitter / other roles).
  covered_sheds: string[];
  weaver_absent_count: number;
  expected_shift_sheds: number;
  advances: number;
  adjustments: number;
  net_payable: number;
}

interface PerWorkerRow {
  employee_id: number;
  code: string;
  full_name: string;
  /** Auto-computed wage earned this week from shift_log (metres × loom rate).
   *  Only populated for metre-basis employees (weavers); 0 for loom-shift rows. */
  wages_earned: number;
  wages_paid: number;   // settlement + same_day
  advances: number;
  adjustments: number;
  net_payable: number;  // wages_paid - advances + adjustments
}

/** Format a local Date as YYYY-MM-DD without UTC conversion. */
function localISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Return the ISO date (YYYY-MM-DD) of Monday for the given date.
function mondayISO(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay(); // 0 Sun .. 6 Sat
  const offset = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + offset);
  return localISO(copy);
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localISO(dt);
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function prettyDate(iso: string): string {
  const [yStr, mStr, dStr] = iso.split('-');
  const y = Number(yStr);
  const mIdx = Number(mStr) - 1;
  const d = Number(dStr);
  const month = MONTHS[mIdx] ?? '';
  return `${d} ${month} ${y}`;
}

function prettyRange(start: string, end: string): string {
  const [, sm] = start.split('-');
  const [, em, ey] = end.split('-');
  if (sm === em) {
    const [, , sd] = start.split('-');
    const [, , ed] = end.split('-');
    const month = MONTHS[Number(sm) - 1] ?? '';
    return `${Number(sd)} – ${Number(ed)} ${month} ${ey}`;
  }
  return `${prettyDate(start)} – ${prettyDate(end)}`;
}

const KIND_PILL: Record<Kind, string> = {
  same_day:   'bg-sky-50 text-sky-700',
  advance:    'bg-amber-50 text-amber-700',
  settlement: 'bg-emerald-50 text-emerald-700',
  adjustment: 'bg-slate-100 text-slate-600',
};

export default async function WeeklyWagesPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const { week } = await searchParams;
  const requested = typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week)
    ? week
    : mondayISO(new Date());

  // Normalise to Monday in case caller passed a mid-week date.
  const weekStart = mondayISO(new Date(requested + 'T00:00:00'));
  const weekEnd = addDaysISO(weekStart, 6);

  const supabase = await createClient();

  // FY label + week number from the SQL helper (migration 037).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fyRows } = await (supabase as any).rpc('fy_week_number', { d: weekStart });
  const fyRow = (Array.isArray(fyRows) ? fyRows[0] : fyRows) as FyWeekRow | null | undefined;
  const fyLabel = fyRow?.fy_label ?? '';
  const weekNo = fyRow?.week_no ?? 0;

  // All active employees, grouped below by wage_alloc_basis.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: empRaw } = await (supabase as any)
    .from('employee')
    .select('id, full_name, code, role, wage_alloc_basis, weekly_salary')
    .eq('status', 'active')
    .order('full_name');
  const allEmployees = (empRaw ?? []) as EmployeeRow[];
  const employees = allEmployees.filter((e) => e.wage_alloc_basis === 'weekly');
  const loomShiftEmps = allEmployees.filter((e) => e.wage_alloc_basis === 'loom_shifts');
  const metreEmps = allEmployees.filter((e) => e.wage_alloc_basis === 'metres');

  // Wage entries in the week.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wageRaw } = await (supabase as any)
    .from('wage_entry')
    .select('id, employee_id, pay_date, period_start, period_end, kind, amount, notes')
    .gte('pay_date', weekStart)
    .lte('pay_date', weekEnd)
    .order('pay_date', { ascending: true });
  const wages = (wageRaw ?? []) as WageRow[];

  // Expense entries in the week.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: expRaw } = await (supabase as any)
    .from('expense_entry')
    .select('id, category, pay_date, amount, notes')
    .gte('pay_date', weekStart)
    .lte('pay_date', weekEnd)
    .order('pay_date', { ascending: true });
  const expenses = (expRaw ?? []) as ExpenseRow[];

  // Look up employee details for any wage row whose employee is not in the
  // weekly-basis list (so we can label rows in the raw table at the bottom).
  const employeeIds = Array.from(new Set(wages.map((w) => w.employee_id)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: empAllRaw } = employeeIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase as any)
        .from('employee')
        .select('id, full_name, code')
        .in('id', employeeIds)
    : { data: [] };
  const empById = new Map<number, { full_name: string; code: string }>();
  for (const e of (empAllRaw ?? []) as Array<{ id: number; full_name: string; code: string }>) {
    empById.set(e.id, { full_name: e.full_name, code: e.code });
  }

  // Totals
  let totalSameDay = 0;
  let totalAdvance = 0;
  let totalSettlement = 0;
  let totalAdjustment = 0;
  for (const w of wages) {
    const a = Number(w.amount ?? 0);
    if (w.kind === 'same_day') totalSameDay += a;
    else if (w.kind === 'advance') totalAdvance += a;
    else if (w.kind === 'settlement') totalSettlement += a;
    else if (w.kind === 'adjustment') totalAdjustment += a;
  }
  const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const netCashOut = totalSettlement + totalAdvance + totalAdjustment + totalSameDay + totalExpenses;

  // Per-employee roll-ups across all kinds in the week.
  const advancesByEmp = new Map<number, number>();
  const adjustmentsByEmp = new Map<number, number>();
  const wagesPaidByEmp = new Map<number, number>();  // settlement + same_day
  for (const w of wages) {
    const a = Number(w.amount ?? 0);
    if (w.kind === 'advance') {
      advancesByEmp.set(w.employee_id, (advancesByEmp.get(w.employee_id) ?? 0) + a);
    } else if (w.kind === 'adjustment') {
      adjustmentsByEmp.set(w.employee_id, (adjustmentsByEmp.get(w.employee_id) ?? 0) + a);
    } else if (w.kind === 'settlement' || w.kind === 'same_day') {
      wagesPaidByEmp.set(w.employee_id, (wagesPaidByEmp.get(w.employee_id) ?? 0) + a);
    }
  }

  // ------------------------------------------------------------------
  // Weaver Wages — auto-compute earnings for metre-basis employees from
  // production_shift_log + production_shift_log_weaver in this week:
  //
  //   earnings(emp) = SUM over (date, shift, loom) the weaver worked
  //                    of metres_woven × loom.default_rate_per_m
  //
  // Loom rate falls back to 0 if the loom has no default_rate_per_m set.
  // ------------------------------------------------------------------
  const wagesEarnedByEmp = new Map<number, number>();
  if (metreEmps.length > 0) {
    const metreEmpIds = metreEmps.map((e) => e.id);
    const { data: parents } = await supabase
      .from('production_shift_log')
      .select('id, loom_id')
      .gte('log_date', weekStart)
      .lte('log_date', weekEnd);
    const parentRows = (parents ?? []) as Array<{ id: number; loom_id: number }>;
    if (parentRows.length > 0) {
      const parentIds = parentRows.map((p) => p.id);
      const loomByParent = new Map<number, number>();
      for (const p of parentRows) loomByParent.set(p.id, p.loom_id);
      const loomIds = Array.from(new Set(parentRows.map((p) => p.loom_id)));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: kidRaw } = await (supabase as any)
        .from('production_shift_log_weaver')
        .select('shift_log_id, employee_id, metres_woven')
        .in('shift_log_id', parentIds)
        .in('employee_id', metreEmpIds);
      const kids = (kidRaw ?? []) as Array<{
        shift_log_id: number;
        employee_id: number;
        metres_woven: number | string | null;
      }>;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: loomRaw } = await (supabase as any)
        .from('loom')
        .select('id, default_rate_per_m')
        .in('id', loomIds);
      const rateByLoom = new Map<number, number>();
      for (const l of (loomRaw ?? []) as Array<{ id: number; default_rate_per_m: number | string | null }>) {
        rateByLoom.set(l.id, Number(l.default_rate_per_m ?? 0));
      }

      for (const k of kids) {
        const loomId = loomByParent.get(k.shift_log_id);
        if (loomId == null) continue;
        const rate = rateByLoom.get(loomId) ?? 0;
        const m = Number(k.metres_woven ?? 0);
        if (m <= 0 || rate <= 0) continue;
        wagesEarnedByEmp.set(
          k.employee_id,
          (wagesEarnedByEmp.get(k.employee_id) ?? 0) + m * rate,
        );
      }
      // Round each weaver's total earned wages to the nearest rupee.
      for (const [empId, amt] of wagesEarnedByEmp) {
        wagesEarnedByEmp.set(empId, Math.round(amt));
      }
    }
  }

  function buildWorkerRows(list: EmployeeRow[]): PerWorkerRow[] {
    return list.map((e) => {
      const wages_paid = wagesPaidByEmp.get(e.id) ?? 0;
      const adv = advancesByEmp.get(e.id) ?? 0;
      const adj = adjustmentsByEmp.get(e.id) ?? 0;
      return {
        employee_id: e.id,
        code: e.code,
        full_name: e.full_name,
        wages_earned: wagesEarnedByEmp.get(e.id) ?? 0,
        wages_paid,
        advances: adv,
        adjustments: adj,
        net_payable: wages_paid - adv + adj,
      };
    });
  }
  const loomShiftRows = buildWorkerRows(loomShiftEmps);
  const metreRows = buildWorkerRows(metreEmps);

  // Attendance-based pro-ration:
  //   * Fitter — each "absent" day inside the week reduces gross by
  //     weekly_salary / 7 (legacy rule, unchanged).
  //   * Winder — gross is reduced for each weaver-absent shift-shed inside
  //     the sheds the winder covered this week. covered_sheds = union of
  //     shed_nos across the winder's non-absent attendance rows (fallback
  //     to all rows). expected = covered_sheds.size * 14 (7 days * 2 shifts).
  //     deduction = weekly_salary * weaver_absent_count / expected.
  //   Other weekly roles stay at full salary.
  const fitterIds = employees
    .filter((e) => (e.role ?? '').toLowerCase() === 'fitter')
    .map((e) => e.id);
  const winderIds = employees
    .filter((e) => (e.role ?? '').toLowerCase() === 'winder')
    .map((e) => e.id);

  // --- Fitter: distinct absent-date count per employee.
  const absentDaysByEmp = new Map<number, number>();
  if (fitterIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: attRaw } = await (supabase as any)
      .from('attendance_entry')
      .select('employee_id, status, attendance_day:attendance_day_id ( attendance_date )')
      .in('employee_id', fitterIds)
      .eq('status', 'absent')
      .gte('attendance_day.attendance_date', weekStart)
      .lte('attendance_day.attendance_date', weekEnd);
    type AttRow = {
      employee_id: number;
      status: string;
      attendance_day: { attendance_date: string } | null;
    };
    const seen = new Map<number, Set<string>>();
    for (const r of (attRaw ?? []) as AttRow[]) {
      const d = r.attendance_day?.attendance_date;
      if (!d) continue;
      const set = seen.get(r.employee_id) ?? new Set<string>();
      set.add(d);
      seen.set(r.employee_id, set);
    }
    for (const [empId, dates] of seen.entries()) {
      absentDaysByEmp.set(empId, dates.size);
    }
  }

  // --- Winder: covered_sheds per winder + weaver-absence counts per shed.
  const coveredShedsByWinder = new Map<number, Set<string>>();
  const weaverAbsentByShed = new Map<string, number>();
  if (winderIds.length > 0) {
    // 1) Fetch this week's attendance rows for each winder to compute
    //    covered_sheds. We need status + shed_nos + shed_no.
    type WinderAttRow = {
      employee_id: number;
      status: string;
      shed_no: string | null;
      shed_nos: string[] | null;
      attendance_day: { attendance_date: string } | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: winAttRaw } = await (supabase as any)
      .from('attendance_entry')
      .select('employee_id, status, shed_no, shed_nos, attendance_day:attendance_day_id ( attendance_date )')
      .in('employee_id', winderIds)
      .gte('attendance_day.attendance_date', weekStart)
      .lte('attendance_day.attendance_date', weekEnd);
    const winAtt = (winAttRaw ?? []) as WinderAttRow[];
    // Group rows by winder, keep only those whose join produced a date
    // (Supabase returns null for the related row when the date filter fails).
    const rowsByWinder = new Map<number, WinderAttRow[]>();
    for (const r of winAtt) {
      if (!r.attendance_day?.attendance_date) continue;
      const list = rowsByWinder.get(r.employee_id) ?? [];
      list.push(r);
      rowsByWinder.set(r.employee_id, list);
    }
    for (const wid of winderIds) {
      const rows = rowsByWinder.get(wid) ?? [];
      const collect = (filterAbsent: boolean): Set<string> => {
        const acc = new Set<string>();
        for (const r of rows) {
          if (filterAbsent && r.status === 'absent') continue;
          const arr = Array.isArray(r.shed_nos) ? r.shed_nos : [];
          for (const s of arr) {
            if (typeof s === 'string' && s.length > 0) acc.add(s);
          }
          if (arr.length === 0 && r.shed_no) acc.add(r.shed_no);
        }
        return acc;
      };
      let covered = collect(true);
      if (covered.size === 0) covered = collect(false);
      coveredShedsByWinder.set(wid, covered);
    }

    // 2) Fetch weaver absences in the week and tally per shed_no.
    //    Only count absences that have an explicit shed_no. Records without
    //    shed_no are not attributable to any specific shed (e.g. weaver marked
    //    absent without a shed assignment that shift), so they must not
    //    inflate any winder's weaver-absent tally.
    type WeaverAbsRow = {
      status: string;
      shed_no: string | null;
      employee: { role: string | null } | null;
      attendance_day: { attendance_date: string } | null;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: weaverAbsRaw } = await (supabase as any)
      .from('attendance_entry')
      .select('status, shed_no, employee:employee_id ( role ), attendance_day:attendance_day_id ( attendance_date )')
      .eq('status', 'absent')
      .gte('attendance_day.attendance_date', weekStart)
      .lte('attendance_day.attendance_date', weekEnd);
    for (const r of (weaverAbsRaw ?? []) as WeaverAbsRow[]) {
      if (!r.attendance_day?.attendance_date) continue;
      const role = (r.employee?.role ?? '').toLowerCase();
      if (role !== 'weaver') continue;
      const shed = r.shed_no;
      if (!shed) continue;
      weaverAbsentByShed.set(shed, (weaverAbsentByShed.get(shed) ?? 0) + 1);
    }
  }

  const perEmployee: PerEmployee[] = employees.map((e) => {
    const full = Number(e.weekly_salary ?? 0);
    const role = (e.role ?? '').toLowerCase();
    let absent = 0;
    let deduction = 0;
    let coveredShedsArr: string[] = [];
    let weaverAbsentCount = 0;
    let expectedShiftSheds = 0;
    if (role === 'fitter') {
      absent = absentDaysByEmp.get(e.id) ?? 0;
      deduction = (full / 7) * absent;
    } else if (role === 'winder') {
      const covered = coveredShedsByWinder.get(e.id) ?? new Set<string>();
      coveredShedsArr = Array.from(covered).sort();
      expectedShiftSheds = coveredShedsArr.length * 14;
      for (const shed of coveredShedsArr) {
        weaverAbsentCount += weaverAbsentByShed.get(shed) ?? 0;
      }
      deduction = expectedShiftSheds > 0
        ? (full * weaverAbsentCount) / expectedShiftSheds
        : 0;
    }
    const book = full - deduction;
    const adv = advancesByEmp.get(e.id) ?? 0;
    const adj = adjustmentsByEmp.get(e.id) ?? 0;
    return {
      employee_id: e.id,
      code: e.code,
      full_name: e.full_name,
      role: e.role,
      full_salary: full,
      absent_days: absent,
      absent_deduction: deduction,
      covered_sheds: coveredShedsArr,
      weaver_absent_count: weaverAbsentCount,
      expected_shift_sheds: expectedShiftSheds,
      book_salary: book,
      advances: adv,
      adjustments: adj,
      net_payable: book - adv + adj,
    };
  });

  const prevWeek = addDaysISO(weekStart, -7);
  const nextWeek = addDaysISO(weekStart, 7);
  const thisWeek = mondayISO(new Date());

  const totals: Record<string, number> = {
    wages: totalSettlement,
    advances: totalAdvance,
    adjustments: totalAdjustment,
    same_day: totalSameDay,
    expenses: totalExpenses,
    net_cash_out: netCashOut,
  };

  const snapshotPayload = {
    fy_label: fyLabel,
    week_no: weekNo,
    week_start: weekStart,
    week_end: weekEnd,
    totals,
    per_employee: perEmployee as unknown as ReadonlyArray<Record<string, unknown>>,
    loom_shift_employees: loomShiftRows as unknown as ReadonlyArray<Record<string, unknown>>,
    metre_employees: metreRows as unknown as ReadonlyArray<Record<string, unknown>>,
    wage_entries: wages as unknown as ReadonlyArray<Record<string, unknown>>,
    expenses: expenses as unknown as ReadonlyArray<Record<string, unknown>>,
  };

  return (
    <div>
      <PageHeader
        title="Weekly Wage Summary"
        subtitle={
          fyLabel
            ? `${fyLabel} · Week ${weekNo} · ${prettyRange(weekStart, weekEnd)}`
            : prettyRange(weekStart, weekEnd)
        }
        crumbs={[{ label: 'Wages', href: '/app/wages' }, { label: 'Weekly Summary' }]}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <ExportButtons weekStart={weekStart} />
            <SaveSnapshotForm payload={snapshotPayload} />
            <Link href="/app/wages/weekly/snapshots" className="btn-secondary">
              <Archive className="w-4 h-4" />
              View snapshots
            </Link>
          </div>
        }
      />

      {/* Week navigator */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-3">
        <Link
          href={`/app/wages/weekly?week=${prevWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Previous week
        </Link>
        <Link
          href={`/app/wages/weekly?week=${nextWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          Next week <ChevronRight className="w-3.5 h-3.5" />
        </Link>
        <Link
          href={`/app/wages/weekly?week=${thisWeek}`}
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
        >
          This week
        </Link>
        <form action="/app/wages/weekly" method="get" className="ml-auto flex items-center gap-2">
          <label htmlFor="jump" className="text-xs text-ink-mute">Jump to week:</label>
          <input
            id="jump"
            name="week"
            type="date"
            defaultValue={weekStart}
            className="input py-1 text-xs max-w-[160px]"
          />
          <button type="submit" className="btn-secondary text-xs py-1 px-2">Go</button>
        </form>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Wages (settlements)</div>
          <div className="num text-xl font-bold">{formatRupee(totalSettlement)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Advances</div>
          <div className="num text-xl font-bold">{formatRupee(totalAdvance)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Adjustments</div>
          <div className="num text-xl font-bold">{formatRupee(totalAdjustment)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Same-day</div>
          <div className="num text-xl font-bold">{formatRupee(totalSameDay)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Expenses</div>
          <div className="num text-xl font-bold">{formatRupee(totalExpenses)}</div>
        </div>
        <div className="card p-3 bg-indigo/5">
          <div className="text-[11px] uppercase tracking-wide text-indigo">Net cash out</div>
          <div className="num text-xl font-bold text-indigo">{formatRupee(netCashOut)}</div>
        </div>
      </div>

      {/* Per-employee */}
      <h2 className="text-sm font-semibold text-ink mb-2">Weekly-basis employees</h2>
      <p className="text-[11px] text-ink-mute mb-2">
        Fitter pro-rate: weekly_salary &times; (7 &minus; absent days) / 7.
        Winder pro-rate: weekly_salary &times; weaver-absent shifts in covered sheds / (covered sheds &times; 14).
        A weaver marked &quot;none&quot; counts as absent only when a shed is picked.
      </p>
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-right px-4 py-3">Full salary</th>
              <th className="text-left px-4 py-3">Coverage / Absences</th>
              <th className="text-right px-4 py-3">Deduction</th>
              <th className="text-right px-4 py-3">Book salary</th>
              <th className="text-right px-4 py-3">Advances</th>
              <th className="text-right px-4 py-3">Adjustments</th>
              <th className="text-right px-4 py-3">Net payable</th>
            </tr>
          </thead>
          <tbody>
            {perEmployee.length ? perEmployee.map((p) => {
              const role = (p.role ?? '').toLowerCase();
              const isFitter = role === 'fitter';
              const isWinder = role === 'winder';
              return (
                <tr key={p.employee_id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.full_name}</div>
                    <div className="text-[11px] text-ink-mute font-mono">{p.code}</div>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize">{p.role}</td>
                  <td className="px-4 py-3 text-right num">{formatRupee(p.full_salary)}</td>
                  <td className="px-4 py-3 text-xs">
                    {isFitter ? (
                      <span>{p.absent_days} absent day{p.absent_days === 1 ? '' : 's'}</span>
                    ) : isWinder ? (
                      <span>
                        <span className="num">{p.weaver_absent_count}</span> weaver-absent /{' '}
                        <span className="num">{p.expected_shift_sheds}</span> expected
                        {p.covered_sheds.length > 0 && (
                          <> &middot; sheds {p.covered_sheds.join(', ')}</>
                        )}
                      </span>
                    ) : (
                      <span className="text-ink-mute">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right num text-rose-700">
                    {p.absent_deduction > 0 ? `\u2212${formatRupee(p.absent_deduction)}` : <span className="text-ink-mute">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right num">{formatRupee(p.book_salary)}</td>
                  <td className="px-4 py-3 text-right num text-amber-700">{formatRupee(p.advances)}</td>
                  <td className="px-4 py-3 text-right num text-slate-600">{formatRupee(p.adjustments)}</td>
                  <td className="px-4 py-3 text-right num font-semibold">{formatRupee(p.net_payable)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No weekly-basis employees configured. Set wage_alloc_basis = weekly on an Employee to see them here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Loom-shift basis */}
      <h2 className="text-sm font-semibold text-ink mb-2">Loom-shift basis employees</h2>
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-right px-4 py-3">Wages paid</th>
              <th className="text-right px-4 py-3">Advances</th>
              <th className="text-right px-4 py-3">Adjustments</th>
              <th className="text-right px-4 py-3">Net payable</th>
            </tr>
          </thead>
          <tbody>
            {loomShiftRows.length ? loomShiftRows.map((p) => (
              <tr key={p.employee_id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{p.code}</div>
                </td>
                <td className="px-4 py-3 text-right num">{formatRupee(p.wages_paid)}</td>
                <td className="px-4 py-3 text-right num text-amber-700">{formatRupee(p.advances)}</td>
                <td className="px-4 py-3 text-right num text-slate-600">{formatRupee(p.adjustments)}</td>
                <td className="px-4 py-3 text-right num font-semibold">{formatRupee(p.net_payable)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No loom-shift basis employees configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Weaver Wages — metre-produced basis */}
      <h2 className="text-sm font-semibold text-ink mb-2">Weaver Wages</h2>
      <p className="text-xs text-ink-soft mb-2">
        Auto-calculated from shift log: sum of metres woven × loom rate (₹/m) across every shift in this week.
      </p>
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-right px-4 py-3">Wages earned<br /><span className="text-[10px] normal-case text-ink-mute">metres × loom rate</span></th>
              <th className="text-right px-4 py-3">Wages paid</th>
              <th className="text-right px-4 py-3">Advances</th>
              <th className="text-right px-4 py-3">Adjustments</th>
              <th className="text-right px-4 py-3">Net payable</th>
            </tr>
          </thead>
          <tbody>
            {metreRows.length ? metreRows.map((p) => (
              <tr key={p.employee_id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3">
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{p.code}</div>
                </td>
                <td className="px-4 py-3 text-right num font-semibold text-indigo-700">
                  {p.wages_earned > 0 ? formatRupee(p.wages_earned) : '—'}
                </td>
                <td className="px-4 py-3 text-right num">{formatRupee(p.wages_paid)}</td>
                <td className="px-4 py-3 text-right num text-amber-700">{formatRupee(p.advances)}</td>
                <td className="px-4 py-3 text-right num text-slate-600">{formatRupee(p.adjustments)}</td>
                <td className="px-4 py-3 text-right num font-semibold">{formatRupee(p.net_payable)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No metre-produced basis employees configured.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Raw wage rows */}
      <h2 className="text-sm font-semibold text-ink mb-2">All wage entries this week</h2>
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Pay date</th>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Kind</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Notes</th>
            </tr>
          </thead>
          <tbody>
            {wages.length ? wages.map((w) => {
              const emp = empById.get(w.employee_id);
              return (
                <tr key={w.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 num text-xs">{w.pay_date}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{emp?.full_name ?? `#${w.employee_id}`}</div>
                    <div className="text-[11px] text-ink-mute font-mono">{emp?.code ?? ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`pill ${KIND_PILL[w.kind]}`}>{w.kind}</span>
                  </td>
                  <td className="px-4 py-3 text-right num font-semibold">{formatRupee(Number(w.amount))}</td>
                  <td className="px-4 py-3 hidden md:table-cell text-xs text-ink-soft">{w.notes ?? '—'}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No wage entries in this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Raw expense rows */}
      <h2 className="text-sm font-semibold text-ink mb-2">Expenses this week</h2>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Pay date</th>
              <th className="text-left px-4 py-3">Category</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Notes</th>
            </tr>
          </thead>
          <tbody>
            {expenses.length ? expenses.map((e) => (
              <tr key={e.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 num text-xs">{e.pay_date}</td>
                <td className="px-4 py-3">
                  <span className="pill bg-slate-100 text-slate-700">{e.category}</span>
                </td>
                <td className="px-4 py-3 text-right num font-semibold">{formatRupee(Number(e.amount))}</td>
                <td className="px-4 py-3 hidden md:table-cell text-xs text-ink-soft">{e.notes ?? '—'}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No expense entries in this week.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
