/**
 * One winder's earned wage for one week.
 *
 * PPK, 2026-09-14: "fetch winder wages automatically to weekly settlement".
 *
 * WHY THE FLAT SALARY WAS THE WRONG NUMBER
 * The wage form prefilled employee.weekly_salary - MALIGA's Rs 3,300 - for
 * every weekly-basis employee. For a winder that is the CEILING, not the
 * wage. What she actually earns is her salary spread over the week's
 * shed-slots and then adjusted: slots where the shed did not run pay
 * nobody, and slots she missed that somebody else wound pay the substitute
 * instead. The Weekly Wage Summary has computed it that way since August;
 * the form did not, so every settlement had to be corrected by hand
 * against the summary - or was silently overpaid.
 *
 * WHY THE WHOLE WEEK IS LOADED FOR ONE ANSWER
 * The allocation moves money BETWEEN winders. Running it for MALIGA alone
 * would compute her losses but not the rupees handed to her for covering
 * KAMACHI. There is no such thing as one winder's figure in isolation, so
 * this loads every winder in the week and picks one result out.
 *
 * Nothing here does arithmetic. The roster comes from loadWeekEmployees
 * and the money from loadWinderAllocation - the same two calls the Weekly
 * Wage Summary makes, in the same order, so the form cannot show a figure
 * the summary disagrees with.
 */
import { loadWeekEmployees } from './week-employees';
import { loadWinderAllocation, type WinderInfo } from './winder-allocation-data';
import type { WinderAllocationResult } from './winder-allocation';

export interface WinderBook extends WinderAllocationResult {
  /** employee.weekly_salary - the full week if nothing were lost. */
  weeklySalary: number;
  /** The sheds this winder is assigned, sorted. */
  assignedSheds: string[];
}

/**
 * Compute the book salary for one winder in one week.
 *
 * Returns null when the employee is not a winder in that week, or has no
 * weekly salary to spread - in both cases the caller should leave the
 * amount alone rather than prefill a zero.
 *
 * @param supabase   A Supabase client (server or browser).
 * @param weekStart  YYYY-MM-DD Monday.
 * @param weekEnd    YYYY-MM-DD Sunday.
 * @param employeeId The winder being settled.
 */
export async function winderBookForWeek(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  weekStart: string,
  weekEnd: string,
  employeeId: number,
): Promise<WinderBook | null> {
  const employees = await loadWeekEmployees(supabase, weekStart, weekEnd);

  const winderEmps = employees.filter(
    (e) => (e.role ?? '').toLowerCase() === 'winder',
  );
  const me = winderEmps.find((e) => e.id === employeeId);
  if (!me) return null;

  const weeklySalary = Number(me.weekly_salary ?? 0);
  if (!Number.isFinite(weeklySalary) || weeklySalary <= 0) return null;

  const winderInfos: WinderInfo[] = winderEmps.map((e) => ({
    id: e.id,
    weeklySalary: Number(e.weekly_salary ?? 0),
    assignedSheds: (Array.isArray(e.default_sheds) ? e.default_sheds : [])
      .filter((s) => typeof s === 'string' && s.length > 0),
  }));

  const alloc = await loadWinderAllocation(
    supabase, weekStart, weekEnd, winderInfos,
  );
  const mine = alloc.get(employeeId);
  if (!mine) return null;

  return {
    ...mine,
    weeklySalary,
    assignedSheds: (Array.isArray(me.default_sheds) ? me.default_sheds : [])
      .filter((s) => typeof s === 'string' && s.length > 0)
      .slice()
      .sort(),
  };
}
