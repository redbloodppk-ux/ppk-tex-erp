/**
 * Who counts as being "in" a given wage week.
 *
 * Extracted from buildWeeklyWageData so the Weekly Wage Summary and the
 * wage entry form agree on the roster. It matters more than it looks: the
 * winder allocation moves money BETWEEN winders, so a screen that computes
 * it over a different set of winders gets a different answer for the same
 * person in the same week.
 *
 * THE RULE
 * Everyone active today, PLUS anyone inactive who has attendance or a wage
 * entry inside this week.
 *
 * The second half is not tidiness. employee.status has no date, so marking
 * a leaver inactive used to erase her from every past week as well - and
 * with her, any wages still owed. PACHAIYAMAAL (EMP-0022) worked 22-23 Jul
 * 2026, was marked inactive, and silently vanished from the week she was
 * never settled for. Nothing on the page could have reminded PPK she was
 * owed anything. A leaver stays visible in the weeks she actually worked
 * and disappears from the weeks after, which is right.
 *
 * The clean fix is an employee.exit_date. That needs a backfill nobody has
 * the dates for, so this derives presence from activity instead.
 */
import { fetchAll } from '@/lib/supabase/fetch-all';

export interface WeekEmployeeRow {
  id: number;
  full_name: string;
  code: string;
  role: string;
  wage_alloc_basis: 'metres' | 'loom_shifts' | 'weekly';
  weekly_salary: number | string | null;
  default_sheds: string[] | null;
}

export const WEEK_EMPLOYEE_COLS =
  'id, full_name, code, role, wage_alloc_basis, weekly_salary, default_sheds';

/**
 * Load every employee who belongs to the week, sorted by name.
 *
 * @param supabase  A Supabase client (server or browser).
 * @param weekStart YYYY-MM-DD Monday.
 * @param weekEnd   YYYY-MM-DD Sunday.
 */
export async function loadWeekEmployees(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  weekStart: string,
  weekEnd: string,
): Promise<WeekEmployeeRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sbEmp = supabase as any;
  const [activeRes, weekAttRes, weekWageRes] = await Promise.all([
    sbEmp.from('employee').select(WEEK_EMPLOYEE_COLS).eq('status', 'active').order('full_name'),
    fetchAll<{ employee_id: number }>((lo, hi) => sbEmp
      .from('attendance_entry')
      .select('id, employee_id, attendance_day:attendance_day_id!inner ( attendance_date )')
      .gte('attendance_day.attendance_date', weekStart)
      .lte('attendance_day.attendance_date', weekEnd)
      .order('id', { ascending: true })
      .range(lo, hi)),
    sbEmp
      .from('wage_entry')
      .select('employee_id')
      .or(
        `and(pay_date.gte.${weekStart},pay_date.lte.${weekEnd}),` +
        `and(period_start.lte.${weekEnd},period_end.gte.${weekStart})`,
      ),
  ]);

  const activeEmployees = (activeRes?.data ?? []) as WeekEmployeeRow[];
  const activeIds = new Set(activeEmployees.map((e) => e.id));
  const touchedIds = new Set<number>();
  for (const r of (weekAttRes?.rows ?? []) as Array<{ employee_id: number }>) {
    if (!activeIds.has(r.employee_id)) touchedIds.add(r.employee_id);
  }
  for (const r of (weekWageRes?.data ?? []) as Array<{ employee_id: number }>) {
    if (!activeIds.has(r.employee_id)) touchedIds.add(r.employee_id);
  }

  let leavers: WeekEmployeeRow[] = [];
  if (touchedIds.size > 0) {
    const { data: leaverRaw } = await sbEmp
      .from('employee')
      .select(WEEK_EMPLOYEE_COLS)
      .in('id', Array.from(touchedIds))
      .order('full_name');
    leavers = (leaverRaw ?? []) as WeekEmployeeRow[];
  }

  return [...activeEmployees, ...leavers]
    .sort((a, b) => (a.full_name ?? '').localeCompare(b.full_name ?? ''));
}
