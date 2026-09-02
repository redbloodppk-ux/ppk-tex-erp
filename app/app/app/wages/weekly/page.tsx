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
import { WeaverRangeExport } from './weaver-range-export';
import { recordDateBounds, clampDate, SOURCES as DATE_SOURCES } from '@/lib/reports/record-bounds';
import { loadWinderAllocation, type WinderInfo } from '@/lib/wages/winder-allocation-data';
import { loadUnrecordedShifts, describeShift } from '@/lib/attendance/unrecorded-shifts';
import { fetchAll } from '@/lib/supabase/fetch-all';

export const metadata = { title: 'Weekly Wage Summary' };
export const dynamic = 'force-dynamic';

interface PageProps {
  // wfrom / wto drive the weaver-wages range export only. Named apart from
  // `week` so choosing a range never moves the week the page is showing.
  searchParams: Promise<{ week?: string; wfrom?: string; wto?: string }>;
}

type Kind = 'same_day' | 'advance' | 'settlement' | 'adjustment' | 'extra_work';

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
  default_sheds: string[] | null;
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
  /** Rupees moved IN for covering absent winders' sheds. */
  reallocated_in: number;
  /** Rupees moved OUT to substitutes because this winder was absent. */
  reallocated_out: number;
  /** Count of shed-slots this winder covered for an absent winder. */
  covered_for_others: number;
  /** Sum of wage_entry rows with kind='settlement' whose period == this week. */
  settlement: number;
  advances: number;
  adjustments: number;
  /** Pay EARNED on top of the weekly figure - cleaning, oiling, hand
   *  knotting bobbins. Kept apart from `adjustments`, which corrects a
   *  wrong book figure rather than rewarding extra work. Migration 267. */
  extra_work: number;
  net_payable: number;
}

interface PerWorkerRow {
  employee_id: number;
  code: string;
  full_name: string;
  /** Auto-computed wage earned this week from shift_log (metres × loom rate).
   *  Only populated for metre-basis employees (weavers); 0 for loom-shift rows. */
  wages_earned: number;
  /** Sum of wage_entry rows with kind='settlement' whose period == this week. */
  settlement: number;
  /** Sum of wage_entry rows with kind='same_day' whose period == this week. */
  same_day_paid: number;
  /** Settlement + same_day combined (kept for Weaver Wages table). */
  wages_paid: number;
  advances: number;
  adjustments: number;
  /** Pay EARNED on top - cleaning, oiling, hand knotting bobbins. Kept
   *  apart from `adjustments`, which corrects a wrong figure rather than
   *  rewarding extra work. Migration 267. */
  extra_work: number;
  /**
   * Weaver Wages Net payable = wages_earned - advances.
   *
   * Adjustments are shown in their own column for visibility (fines /
   * bonuses / corrections) but are intentionally NOT folded into Net
   * payable - the metre-basis weaver is paid strictly against what
   * they've earned this week minus any advances drawn against it.
   */
  net_payable: number;
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
  extra_work: 'bg-teal-50 text-teal-700',
};

export default async function WeeklyWagesPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const { week, wfrom, wto } = await searchParams;
  const requested = typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week)
    ? week
    : mondayISO(new Date());

  // Normalise to Monday in case caller passed a mid-week date.
  const weekStart = mondayISO(new Date(requested + 'T00:00:00'));
  const weekEnd = addDaysISO(weekStart, 6);

  const supabase = await createClient();

  // Weaver-wages range export. Defaults to the visible week so the buttons
  // work without touching the dates, and is clamped to the days that have
  // production records — a range reaching back before the books would
  // otherwise produce week after week of zeroes and a total that reads
  // like a real, low figure.
  const weaverBounds = await recordDateBounds(supabase, DATE_SOURCES.production);
  const isIso = (s: unknown): s is string =>
    typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const rangeFrom = clampDate(isIso(wfrom) ? wfrom : weekStart, weaverBounds);
  const rangeToRaw = clampDate(isIso(wto) ? wto : weekEnd, weaverBounds);
  // A To before From would loop over no weeks and hand back an empty file.
  const rangeTo = rangeToRaw < rangeFrom ? rangeFrom : rangeToRaw;

  // Shifts in THIS week that were never recorded. A missing shift shrinks
  // every winder's denominator and hides idle sheds, so the figures below
  // cannot be trusted until it is resolved. See lib/attendance/
  // unrecorded-shifts.ts.
  const unrecorded = await loadUnrecordedShifts(supabase, weekStart, weekEnd);

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
    .select('id, full_name, code, role, wage_alloc_basis, weekly_salary, default_sheds')
    .eq('status', 'active')
    .order('full_name');
  const allEmployees = (empRaw ?? []) as EmployeeRow[];
  const employees = allEmployees.filter((e) => e.wage_alloc_basis === 'weekly');
  const loomShiftEmps = allEmployees.filter((e) => e.wage_alloc_basis === 'loom_shifts');
  const metreEmps = allEmployees.filter((e) => e.wage_alloc_basis === 'metres');

  // Wage entries that BELONG to this week. We filter by period_start (the
  // Monday of the wage's period) instead of pay_date so that a Weekly
  // Settlement made on, say, Mon 1-Jun for the previous week (25-31 May)
  // still shows up in the 25-31 May summary - exactly what the slider in
  // the wage form was designed for. For same_day / advance / adjustment
  // entries the period auto-matches the pay_date's week, so they still
  // surface under the right week without any change to how they're entered.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wageRaw } = await (supabase as any)
    .from('wage_entry')
    .select('id, employee_id, pay_date, period_start, period_end, kind, amount, notes')
    .gte('period_start', weekStart)
    .lte('period_start', weekEnd)
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
  let totalExtraWork = 0;
  for (const w of wages) {
    const a = Number(w.amount ?? 0);
    if (w.kind === 'same_day') totalSameDay += a;
    else if (w.kind === 'advance') totalAdvance += a;
    else if (w.kind === 'settlement') totalSettlement += a;
    else if (w.kind === 'adjustment') totalAdjustment += a;
    else if (w.kind === 'extra_work') totalExtraWork += a;
  }
  const totalExpenses = expenses.reduce((acc, e) => acc + Number(e.amount ?? 0), 0);
  const netCashOut = totalSettlement + totalAdvance + totalAdjustment + totalSameDay + totalExpenses;

  // Per-employee roll-ups across all kinds in the week.
  const advancesByEmp    = new Map<number, number>();
  const adjustmentsByEmp = new Map<number, number>();
  const extraWorkByEmp = new Map<number, number>();
  const wagesPaidByEmp   = new Map<number, number>();  // settlement + same_day combined
  const settlementByEmp  = new Map<number, number>();  // settlement-kind only
  const sameDayByEmp     = new Map<number, number>();  // same_day-kind only
  for (const w of wages) {
    const a = Number(w.amount ?? 0);
    if (w.kind === 'advance') {
      advancesByEmp.set(w.employee_id, (advancesByEmp.get(w.employee_id) ?? 0) + a);
    } else if (w.kind === 'adjustment') {
      adjustmentsByEmp.set(w.employee_id, (adjustmentsByEmp.get(w.employee_id) ?? 0) + a);
    } else if (w.kind === 'extra_work') {
      extraWorkByEmp.set(w.employee_id, (extraWorkByEmp.get(w.employee_id) ?? 0) + a);
    } else if (w.kind === 'settlement') {
      settlementByEmp.set(w.employee_id, (settlementByEmp.get(w.employee_id) ?? 0) + a);
      wagesPaidByEmp.set(w.employee_id, (wagesPaidByEmp.get(w.employee_id) ?? 0) + a);
    } else if (w.kind === 'same_day') {
      sameDayByEmp.set(w.employee_id, (sameDayByEmp.get(w.employee_id) ?? 0) + a);
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
    const parents = await fetchAll<{ id: number; loom_id: number }>((lo, hi) => supabase
      .from('production_shift_log')
      .select('id, loom_id')
      .gte('log_date', weekStart)
      .lte('log_date', weekEnd)
      .order('id', { ascending: true })
      .range(lo, hi));
    const parentRows = parents.rows;
    if (parentRows.length > 0) {
      const parentIds = parentRows.map((p) => p.id);
      const loomByParent = new Map<number, number>();
      for (const p of parentRows) loomByParent.set(p.id, p.loom_id);
      const loomIds = Array.from(new Set(parentRows.map((p) => p.loom_id)));

      const kidRes = await fetchAll<{
        shift_log_id: number;
        employee_id: number;
        metres_woven: number | string | null;
      }>((lo, hi) => (supabase as unknown as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        from: (t: string) => any;
      }).from('production_shift_log_weaver')
        .select('id, shift_log_id, employee_id, metres_woven')
        .in('shift_log_id', parentIds)
        .in('employee_id', metreEmpIds)
        .order('id', { ascending: true })
        .range(lo, hi));
      const kids = kidRes.rows;

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
      const wages_earned  = wagesEarnedByEmp.get(e.id) ?? 0;
      const wages_paid    = wagesPaidByEmp.get(e.id) ?? 0;
      const settlement    = settlementByEmp.get(e.id) ?? 0;
      const same_day_paid = sameDayByEmp.get(e.id) ?? 0;
      const adv = advancesByEmp.get(e.id) ?? 0;
      const adj = adjustmentsByEmp.get(e.id) ?? 0;
      const extra = extraWorkByEmp.get(e.id) ?? 0;
      return {
        employee_id: e.id,
        code: e.code,
        full_name: e.full_name,
        wages_earned,
        settlement,
        same_day_paid,
        wages_paid,
        advances: adv,
        adjustments: adj,
        extra_work: extra,
        // Default formula (kept for loom-shift basis). For metre-basis
        // weavers we override below so Net payable = wages earned -
        // advances, matching the Weaver Wages section's intent.
        net_payable: wages_paid - adv + adj + extra,
      };
    });
  }
  const loomShiftRows = buildWorkerRows(loomShiftEmps);
  const metreRows = buildWorkerRows(metreEmps).map((r): PerWorkerRow => ({
    ...r,
    // Adjustments are deliberately NOT folded in here (see above), but
    // extra work is - it is money earned, not a correction.
    net_payable: r.wages_earned - r.advances + r.extra_work,
  }));

  // Attendance-based pro-ration:
  //   * FITTER is paid per DAY present: weekly_salary * (7 - absent) / 7.
  //     A fitter maintains looms across the mill rather than tending one
  //     shed, so a shed standing idle is not his loss. Confirmed by PPK,
  //     2026-08-30.
  //   * WINDER is paid per assigned shed per shift-slot, via the shared
  //     allocator below.
  //   * Other weekly roles stay at full salary.
  //
  // WHAT THIS REPLACED, AND WHY IT MATTERED
  // Until 2026-08-30 this page paid fitters on the same shed tally as
  // winders, counting EVERY weaver row marked 'absent' or 'none' on a
  // covered shed - without checking whether some other weaver was standing
  // at that shed. That is the exact rule deleted from the winder path in
  // August, where it had cost MALIGA Rs 1,283.33 in one week (see
  // deriveWeaverGapSlots). It survived here and was docking MAHALINGAM
  // Rs 1,600.00 in the week of 24 Aug - 8 counted rows on sheds 3 and 4,
  // five of them ASHOK's morning shed carried onto night rows where RAVI
  // OLD was actually weaving - while the man was present all seven days.
  //
  // It also disagreed with lib/wages/weekly-data.ts, which feeds the CSV
  // and PDF exports and always used the day-based rule. The screen said
  // Rs 2,400.00 and the export said Rs 4,000.00 for the same man in the
  // same week. Two implementations of one rule, drifted apart; this page
  // now matches the library.
  const fitterIds = employees
    .filter((e) => (e.role ?? '').toLowerCase() === 'fitter')
    .map((e) => e.id);

  // --- Fitter: distinct days marked absent within the week.
  //
  //     Days, not shift-slots: a fitter who works the morning and is gone
  //     at night is not half-absent, he has done his day. Mirrors
  //     buildWeeklyWageData in lib/wages/weekly-data.ts exactly, so the
  //     screen and the exports cannot drift apart again.
  const absentDaysByEmp = new Map<number, number>();
  if (fitterIds.length > 0) {
    type AbsRow = {
      employee_id: number;
      attendance_day: { attendance_date: string } | null;
    };
    const absRes = await fetchAll<AbsRow>((lo, hi) => (supabase as unknown as {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      from: (t: string) => any;
    })
      .from('attendance_entry')
      // !inner: real join filter, avoids the 1000-row cap on full history.
      .select('id, employee_id, attendance_day:attendance_day_id!inner ( attendance_date )')
      .in('employee_id', fitterIds)
      .eq('status', 'absent')
      .gte('attendance_day.attendance_date', weekStart)
      .lte('attendance_day.attendance_date', weekEnd)
      .order('id', { ascending: true })
      .range(lo, hi));
    // Distinct DATES — being marked absent for both shifts of one day is
    // still one absent day.
    const datesByEmp = new Map<number, Set<string>>();
    for (const r of absRes.rows) {
      const d = r.attendance_day?.attendance_date;
      if (!d) continue;
      const set = datesByEmp.get(r.employee_id) ?? new Set<string>();
      set.add(d);
      datesByEmp.set(r.employee_id, set);
    }
    for (const [empId, dates] of datesByEmp.entries()) {
      absentDaysByEmp.set(empId, dates.size);
    }
  }

  // --- Winder: per-slot allocation with substitute reallocation. Money
  //     moves from an absent winder to whoever covered her sheds that slot.
  //     Assigned sheds come from employee.default_sheds; the shared loader +
  //     pure helper own the arithmetic (same source the exports use).
  const winderEmps = employees.filter((e) => (e.role ?? '').toLowerCase() === 'winder');
  const winderInfos: WinderInfo[] = winderEmps.map((e) => ({
    id: e.id,
    weeklySalary: Number(e.weekly_salary ?? 0),
    assignedSheds: (Array.isArray(e.default_sheds) ? e.default_sheds : [])
      .filter((s) => typeof s === 'string' && s.length > 0),
  }));
  const winderAlloc = await loadWinderAllocation(supabase, weekStart, weekEnd, winderInfos);

  const perEmployee: PerEmployee[] = employees.map((e) => {
    const full = Number(e.weekly_salary ?? 0);
    const role = (e.role ?? '').toLowerCase();
    let deduction = 0;
    let absentDays = 0;
    let coveredShedsArr: string[] = [];
    let weaverAbsentCount = 0;
    let expectedShiftSheds = 0;
    let reallocatedIn = 0;
    let reallocatedOut = 0;
    let coveredForOthers = 0;
    let book = full;
    if (role === 'fitter') {
      absentDays = absentDaysByEmp.get(e.id) ?? 0;
      deduction = (full / 7) * absentDays;
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
    const settlement = settlementByEmp.get(e.id) ?? 0;
    const adv = advancesByEmp.get(e.id) ?? 0;
    const adj = adjustmentsByEmp.get(e.id) ?? 0;
    const extra = extraWorkByEmp.get(e.id) ?? 0;
    return {
      employee_id: e.id,
      code: e.code,
      full_name: e.full_name,
      role: e.role,
      full_salary: full,
      absent_days: absentDays, // fitters only; 0 for every other role
      absent_deduction: deduction,
      covered_sheds: coveredShedsArr,
      weaver_absent_count: weaverAbsentCount,
      expected_shift_sheds: expectedShiftSheds,
      reallocated_in: reallocatedIn,
      reallocated_out: reallocatedOut,
      covered_for_others: coveredForOthers,
      book_salary: book,
      settlement,
      advances: adv,
      adjustments: adj,
      extra_work: extra,
      // "Net paid" = total cash actually flowing out to this employee this
      // week (settlement + advances + adjustments + extra work). Book
      // salary stays as the entitlement reference, but it is NOT in the
      // cash math anymore.
      net_payable: settlement + adv + adj + extra,
    };
  });

  const prevWeek = addDaysISO(weekStart, -7);
  const nextWeek = addDaysISO(weekStart, 7);
  const thisWeek = mondayISO(new Date());

  const totals: Record<string, number> = {
    wages: totalSettlement,
    advances: totalAdvance,
    adjustments: totalAdjustment,
    extra_work: totalExtraWork,
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

      {unrecorded.length > 0 && (
        <div className="mb-4 rounded-md border-2 border-rose-300 bg-rose-50 p-3">
          <div className="text-sm font-semibold text-rose-900">
            {unrecorded.length === 1
              ? '1 shift this week was never recorded'
              : `${unrecorded.length} shifts this week were never recorded`}
            {' \u2014 the figures below may be wrong'}
          </div>
          <div className="mt-1 text-xs text-rose-800">
            A shift with no attendance is neither worked nor a holiday. It drops
            out of the week, so every winder&rsquo;s per-shed rate rises and no
            shed on it can be counted idle.
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {unrecorded.map((u) => (
              <Link
                key={`${u.date}:${u.shift}`}
                href={`/app/attendance/mark?date=${u.date}&shift=${u.shift}`}
                className="rounded-md border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100"
              >
                {describeShift(u)} &rarr;
              </Link>
            ))}
          </div>
        </div>
      )}

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
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Extra work</div>
          <div className="num text-xl font-bold">{formatRupee(totalExtraWork)}</div>
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

      <WeaverRangeExport
        from={rangeFrom}
        to={rangeTo}
        min={weaverBounds?.min}
        max={weaverBounds?.max}
        weekStart={weekStart}
      />

      {/* Per-employee */}
      <h2 className="text-sm font-semibold text-ink mb-2">Weekly-basis employees</h2>
      <p className="text-[11px] text-ink-mute mb-2">
        Fitter pro-rate: weekly_salary &times; (7 &minus; absent days) / 7 &mdash;
        counted in whole days, not shifts.
        Winder pay is per assigned shed &times; shift-slot, over the mill&apos;s
        standard <strong>13-shift week</strong> (every shift but Sunday night).
        A shift the mill did not run &mdash; no weavers, power cut, maintenance,
        festival &mdash; still counts in the week and pays nobody; it does not
        shrink the week. If a winder is absent while the shed runs, that
        shed-slot&apos;s money moves to whichever winder actually covered it;
        if nobody covered, she keeps it, having wound ahead.
        A weaver marked &quot;none&quot; counts as absent only when a shed is
        picked, and only where no other weaver worked that shed.
      </p>
      <div className="card overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3 sticky left-0 z-20 bg-cloud">Employee</th>
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-right px-4 py-3">Full salary</th>
              <th className="text-left px-4 py-3">Coverage / Absences</th>
              <th className="text-right px-4 py-3">Deduction</th>
              <th className="text-right px-4 py-3">Book salary</th>
              <th className="text-right px-4 py-3">Settlement</th>
              <th className="text-right px-4 py-3">Advances</th>
              <th className="text-right px-4 py-3">Extra work<br /><span className="text-[10px] normal-case text-ink-mute">cleaning, oiling, knotting</span></th>
              <th className="text-right px-4 py-3">Adjustments</th>
              <th className="text-right px-4 py-3">Net paid<br /><span className="text-[10px] normal-case text-ink-mute">settlement + advances + adjustments + extra work</span></th>
            </tr>
          </thead>
          <tbody>
            {perEmployee.length ? perEmployee.map((p) => {
              const role = (p.role ?? '').toLowerCase();
              const isFitter = role === 'fitter';
              const isWinder = role === 'winder';
              return (
                <tr key={p.employee_id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 sticky left-0 z-10 bg-paper">
                    <div className="font-medium">{p.full_name}</div>
                    <div className="text-[11px] text-ink-mute font-mono">{p.code}</div>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize">{p.role}</td>
                  <td className="px-4 py-3 text-right num">{formatRupee(p.full_salary)}</td>
                  <td className="px-4 py-3 text-xs">
                    {isFitter ? (
                      <span>
                        {p.absent_days > 0 ? (
                          <>
                            <span className="num">{p.absent_days}</span> day
                            {p.absent_days === 1 ? '' : 's'} absent of{' '}
                            <span className="num">7</span>
                          </>
                        ) : (
                          <span className="text-ink-mute">present all 7 days</span>
                        )}
                      </span>
                    ) : isWinder ? (
                      <span>
                        {/* PPK counts the week as ran / closed out of the
                            full 13 shifts, so the screen says it his way.
                            "8 weaver-absent / 20 expected" described the
                            same figures and was checkable by nobody. */}
                        <span className="num">
                          {p.expected_shift_sheds - p.weaver_absent_count}
                        </span> ran /{' '}
                        <span className="num">{p.weaver_absent_count}</span> closed of{' '}
                        <span className="num">{p.expected_shift_sheds}</span>
                        {p.covered_sheds.length > 0 && (
                          <> &middot; sheds {p.covered_sheds.join(', ')}</>
                        )}
                        {isWinder && p.reallocated_in > 0 && (
                          <div className="text-emerald-700">
                            +{formatRupee(p.reallocated_in)} covering{' '}
                            <span className="num">{p.covered_for_others}</span> shed-slots
                          </div>
                        )}
                        {isWinder && p.reallocated_out > 0 && (
                          <div className="text-rose-700">
                            &minus;{formatRupee(p.reallocated_out)} moved to substitute
                          </div>
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
                  <td className="px-4 py-3 text-right num text-emerald-700">{formatRupee(p.settlement)}</td>
                  <td className="px-4 py-3 text-right num text-amber-700">{formatRupee(p.advances)}</td>
                  <td className="px-4 py-3 text-right num text-emerald-700">{formatRupee(p.extra_work)}</td>
                  <td className="px-4 py-3 text-right num text-slate-600">{formatRupee(p.adjustments)}</td>
                  <td className="px-4 py-3 text-right num font-semibold">{formatRupee(p.net_payable)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-ink-soft">
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
              <th className="text-left px-4 py-3 sticky left-0 z-20 bg-cloud">Employee</th>
              <th className="text-right px-4 py-3">Settlement</th>
              <th className="text-right px-4 py-3">Wages paid<br /><span className="text-[10px] normal-case text-ink-mute">same-day only</span></th>
              <th className="text-right px-4 py-3">Advances</th>
              <th className="text-right px-4 py-3">Extra work<br /><span className="text-[10px] normal-case text-ink-mute">cleaning, oiling, knotting</span></th>
              <th className="text-right px-4 py-3">Adjustments</th>
              <th className="text-right px-4 py-3">Net paid<br /><span className="text-[10px] normal-case text-ink-mute">settlement + wages paid + advances + adjustments + extra work</span></th>
            </tr>
          </thead>
          <tbody>
            {loomShiftRows.length ? loomShiftRows.map((p) => (
              <tr key={p.employee_id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 sticky left-0 z-10 bg-paper">
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{p.code}</div>
                </td>
                <td className="px-4 py-3 text-right num text-emerald-700">{formatRupee(p.settlement)}</td>
                <td className="px-4 py-3 text-right num">{formatRupee(p.same_day_paid)}</td>
                <td className="px-4 py-3 text-right num text-amber-700">{formatRupee(p.advances)}</td>
                <td className="px-4 py-3 text-right num text-emerald-700">{formatRupee(p.extra_work)}</td>
                <td className="px-4 py-3 text-right num text-slate-600">{formatRupee(p.adjustments)}</td>
                <td className="px-4 py-3 text-right num font-semibold">{formatRupee(p.settlement + p.same_day_paid + p.advances + p.adjustments + p.extra_work)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-soft">
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
              <th className="text-left px-4 py-3 sticky left-0 z-20 bg-cloud">Employee</th>
              <th className="text-right px-4 py-3">Wages earned<br /><span className="text-[10px] normal-case text-ink-mute">metres × loom rate</span></th>
              <th className="text-right px-4 py-3">Wages paid</th>
              <th className="text-right px-4 py-3">Advances</th>
              <th className="text-right px-4 py-3">Extra work<br /><span className="text-[10px] normal-case text-ink-mute">cleaning, oiling, knotting</span></th>
              <th className="text-right px-4 py-3">Adjustments</th>
              <th className="text-right px-4 py-3">Net payable<br /><span className="text-[10px] normal-case text-ink-mute">wages earned &minus; advances</span></th>
            </tr>
          </thead>
          <tbody>
            {metreRows.length ? metreRows.map((p) => (
              <tr key={p.employee_id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 sticky left-0 z-10 bg-paper">
                  <div className="font-medium">{p.full_name}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{p.code}</div>
                </td>
                <td className="px-4 py-3 text-right num font-semibold text-indigo-700">
                  {p.wages_earned > 0 ? formatRupee(p.wages_earned) : '—'}
                </td>
                <td className="px-4 py-3 text-right num">{formatRupee(p.wages_paid)}</td>
                <td className="px-4 py-3 text-right num text-amber-700">{formatRupee(p.advances)}</td>
                <td className="px-4 py-3 text-right num text-emerald-700">{formatRupee(p.extra_work)}</td>
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
