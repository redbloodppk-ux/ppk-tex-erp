/**
 * Shared builder for the Weekly Wage Summary payload.
 *
 * Owns every Supabase query and every roll-up that the weekly screen,
 * the snapshot upsert, the CSV export and the PDF export depend on.
 * Keeping a single source of truth means the three downstream surfaces
 * (page, /api/wages/weekly/export, /api/wages/weekly/export-pdf) can
 * never disagree about totals or pro-ration logic.
 */
import { createClient } from '@/lib/supabase/server';
import { loadWinderAllocation, type WinderInfo } from './winder-allocation-data';

export type WageKind = 'same_day' | 'advance' | 'settlement' | 'adjustment';

export interface WageRow {
  id: number;
  employee_id: number;
  pay_date: string;
  period_start: string;
  period_end: string;
  kind: WageKind;
  amount: number;
  notes: string | null;
}

export interface WageRowWithEmployee extends WageRow {
  employee_name: string;
  employee_code: string;
}

export interface ExpenseRow {
  id: number;
  category: string;
  pay_date: string;
  amount: number;
  notes: string | null;
}

export interface EmployeeRow {
  id: number;
  full_name: string;
  code: string;
  role: string;
  wage_alloc_basis: 'metres' | 'loom_shifts' | 'weekly';
  weekly_salary: number | string | null;
  default_sheds: string[] | null;
}

interface FyWeekRow {
  fy_label: string;
  week_no: number;
  week_start: string;
  week_end: string;
}

export interface PerEmployee {
  employee_id: number;
  code: string;
  full_name: string;
  role: string;
  full_salary: number;
  absent_days: number;
  absent_deduction: number;
  covered_sheds: string[];
  weaver_absent_count: number;
  expected_shift_sheds: number;
  /** Rupees moved IN to this winder for covering absent winders' sheds. */
  reallocated_in: number;
  /** Rupees moved OUT to substitutes because this winder was absent. */
  reallocated_out: number;
  /** Count of shed-slots this winder covered for an absent winder. */
  covered_for_others: number;
  book_salary: number;
  advances: number;
  adjustments: number;
  net_payable: number;
}

export interface PerWorkerRow {
  employee_id: number;
  code: string;
  full_name: string;
  /** Auto-computed wage earned this week from shift_log (metres × the shift
   *  log's own frozen rate_per_m, not the loom's live rate).
   *  Only populated for metre-basis employees (weavers); 0 for loom-shift rows. */
  wages_earned: number;
  wages_paid: number;
  advances: number;
  adjustments: number;
  net_payable: number;
}

export interface WeeklyTotals {
  wages: number;
  advances: number;
  adjustments: number;
  same_day: number;
  expenses: number;
  net_cash_out: number;
}

export interface WeeklyData {
  fy_label: string;
  week_no: number;
  week_start: string;
  week_end: string;
  totals: WeeklyTotals;
  per_employee: PerEmployee[];
  loom_shift_employees: PerWorkerRow[];
  metre_employees: PerWorkerRow[];
  wage_entries: WageRowWithEmployee[];
  expenses: ExpenseRow[];
}

/** Format a local Date as YYYY-MM-DD without UTC conversion. */
function localISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Return the ISO date (YYYY-MM-DD) of Monday for the given date.
export function mondayISO(d: Date): string {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = copy.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  copy.setDate(copy.getDate() + offset);
  return localISO(copy);
}

export function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return localISO(dt);
}

/**
 * Fetches and rolls up everything needed for the Weekly Wage Summary.
 * @param weekStartIso  Monday of the requested week, format YYYY-MM-DD.
 */
export async function buildWeeklyWageData(weekStartIso: string): Promise<WeeklyData> {
  const weekStart = mondayISO(new Date(weekStartIso + 'T00:00:00'));
  const weekEnd = addDaysISO(weekStart, 6);

  const supabase = await createClient();

  // FY label + week number from the SQL helper (migration 037).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fyRows } = await (supabase as any).rpc('fy_week_number', { d: weekStart });
  const fyRow = (Array.isArray(fyRows) ? fyRows[0] : fyRows) as FyWeekRow | null | undefined;
  const fyLabel = fyRow?.fy_label ?? '';
  const weekNo = fyRow?.week_no ?? 0;

  // All active employees, grouped by wage_alloc_basis.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: empRaw } = await (supabase as any)
    .from('employee')
    .select('id, full_name, code, role, wage_alloc_basis, weekly_salary, default_sheds')
    .eq('status', 'active')
    .order('full_name');
  const allEmployees = (empRaw ?? []) as EmployeeRow[];
  const weeklyEmps = allEmployees.filter((e) => e.wage_alloc_basis === 'weekly');
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

  // Lookup employee details for any wage row whose employee isn't in
  // weeklyEmps (e.g. loom-shift or metre basis workers).
  const employeeIds = Array.from(new Set(wages.map((w) => w.employee_id)));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const empAllRes = employeeIds.length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await (supabase as any)
        .from('employee')
        .select('id, full_name, code')
        .in('id', employeeIds)
    : { data: [] };
  const empAllRaw = empAllRes.data ?? [];
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
  const wagesPaidByEmp = new Map<number, number>();
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

  // Weaver Wages — auto-compute earnings for metre-basis employees from
  // production_shift_log + production_shift_log_weaver in this week:
  //   earnings(emp) = SUM over (date, shift) the weaver worked
  //                    of metres_woven × shift_log.rate_per_m (frozen at
  //                    insert time by DB trigger — never the loom's live
  //                    default_rate_per_m, so closed weeks never reprice).
  const wagesEarnedByEmp = new Map<number, number>();
  if (metreEmps.length > 0) {
    const metreEmpIds = metreEmps.map((e) => e.id);
    const { data: parents } = await supabase
      .from('production_shift_log')
      .select('id, rate_per_m')
      .gte('log_date', weekStart)
      .lte('log_date', weekEnd);
    const parentRows = (parents ?? []) as Array<{ id: number; rate_per_m: number | string | null }>;
    if (parentRows.length > 0) {
      const parentIds = parentRows.map((p) => p.id);
      const rateByParent = new Map<number, number>();
      for (const p of parentRows) rateByParent.set(p.id, Number(p.rate_per_m ?? 0));

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

      for (const k of kids) {
        const rate = rateByParent.get(k.shift_log_id) ?? 0;
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
  // For Weaver Wages (metre-basis) the Net payable is intentionally
  // wages_earned - advances (no adjustments folded in). Adjustments are
  // still surfaced on the row but are not paid through this column.
  const metreRows = buildWorkerRows(metreEmps).map((r): PerWorkerRow => ({
    ...r,
    net_payable: r.wages_earned - r.advances,
  }));

  // Attendance-based pro-ration: fitter & winder.
  const fitterIds = weeklyEmps
    .filter((e) => (e.role ?? '').toLowerCase() === 'fitter')
    .map((e) => e.id);

  // Fitter: distinct absent-date count per employee.
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

  // Winder: per-slot allocation with substitute reallocation. Money moves
  // from an absent winder to whoever actually covered her sheds that slot.
  // Assigned sheds come from employee.default_sheds; the shared loader +
  // pure helper own the arithmetic so screen and exports never diverge.
  const winderEmps = weeklyEmps.filter((e) => (e.role ?? '').toLowerCase() === 'winder');
  const winderInfos: WinderInfo[] = winderEmps.map((e) => ({
    id: e.id,
    weeklySalary: Number(e.weekly_salary ?? 0),
    assignedSheds: (Array.isArray(e.default_sheds) ? e.default_sheds : [])
      .filter((s) => typeof s === 'string' && s.length > 0),
  }));
  const winderAlloc = await loadWinderAllocation(supabase, weekStart, weekEnd, winderInfos);

  const perEmployee: PerEmployee[] = weeklyEmps.map((e) => {
    const full = Number(e.weekly_salary ?? 0);
    const role = (e.role ?? '').toLowerCase();
    let absent = 0;
    let deduction = 0;
    let coveredShedsArr: string[] = [];
    let weaverAbsentCount = 0;
    let expectedShiftSheds = 0;
    let reallocatedIn = 0;
    let reallocatedOut = 0;
    let coveredForOthers = 0;
    let book = full;
    if (role === 'fitter') {
      absent = absentDaysByEmp.get(e.id) ?? 0;
      deduction = (full / 7) * absent;
      book = full - deduction;
    } else if (role === 'winder') {
      const alloc = winderAlloc.get(e.id);
      coveredShedsArr = (Array.isArray(e.default_sheds) ? e.default_sheds : [])
        .filter((s) => typeof s === 'string' && s.length > 0)
        .slice()
        .sort();
      if (alloc) {
        deduction = alloc.deduction;
        weaverAbsentCount = alloc.weaverAbsentCount;
        expectedShiftSheds = alloc.expectedShedSlots;
        reallocatedIn = alloc.reallocatedIn;
        reallocatedOut = alloc.reallocatedOut;
        coveredForOthers = alloc.coveredForOthers;
        book = alloc.book;
      }
    }
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
      reallocated_in: reallocatedIn,
      reallocated_out: reallocatedOut,
      covered_for_others: coveredForOthers,
      book_salary: book,
      advances: adv,
      adjustments: adj,
      net_payable: book - adv + adj,
    };
  });

  // Hydrate wage entries with employee name/code for export rendering.
  const wageEntriesEnriched: WageRowWithEmployee[] = wages.map((w) => {
    const emp = empById.get(w.employee_id);
    return {
      id: w.id,
      employee_id: w.employee_id,
      pay_date: w.pay_date,
      period_start: w.period_start,
      period_end: w.period_end,
      kind: w.kind,
      amount: Number(w.amount ?? 0),
      notes: w.notes,
      employee_name: emp?.full_name ?? `#${w.employee_id}`,
      employee_code: emp?.code ?? '',
    };
  });

  return {
    fy_label: fyLabel,
    week_no: weekNo,
    week_start: weekStart,
    week_end: weekEnd,
    totals: {
      wages: totalSettlement,
      advances: totalAdvance,
      adjustments: totalAdjustment,
      same_day: totalSameDay,
      expenses: totalExpenses,
      net_cash_out: netCashOut,
    },
    per_employee: perEmployee,
    loom_shift_employees: loomShiftRows,
    metre_employees: metreRows,
    wage_entries: wageEntriesEnriched,
    expenses,
  };
}
