/**
 * Shifts that were never recorded — the single source for all four
 * warnings (bell, weekly wage banner, attendance banner, dashboard).
 *
 * WHY THIS EXISTS
 * A day normally carries two attendance_day rows, morning and night. When
 * the mill does not run a shift it should be recorded as a HOLIDAY, the
 * way every Sunday night is. What keeps happening instead is that the row
 * is simply never created, and a missing row is silent:
 *
 *   - the shift drops out of the week, so every winder's denominator
 *     shrinks and each shed-slot is worth more than it should be;
 *   - no shed on that shift can be idle, because there is nothing to be
 *     idle about, so nobody is docked for looms that stood still.
 *
 * Four of these were found on 2026-08-24 (18 Jul, 24 Jul, 12 Aug, 22 Aug).
 * Adding just one of them - 22 Aug night - moved KAMACHI's week by
 * Rs 153.85 and revealed two more sheds that had been idle unpaid.
 *
 * Nothing in the ERP flagged any of it. That is what this fixes.
 */

/** One attendance_day row, reduced to what the check needs. */
export interface ShiftRow {
  /** YYYY-MM-DD */
  date: string;
  shift: string;
}

export interface UnrecordedShift {
  /** YYYY-MM-DD */
  date: string;
  /** The shift with no row at all. */
  shift: 'morning' | 'night';
}

const SHIFTS: Array<'morning' | 'night'> = ['morning', 'night'];

/**
 * Dates where one shift was recorded and the other was not.
 *
 * A date with NEITHER shift recorded is deliberately ignored: that is a
 * day the mill was shut and nobody opened the screen, not a half-finished
 * entry. The signal we want is the asymmetry - somebody marked the
 * morning and never came back for the night.
 *
 * `today` is excluded along with anything after it, because tonight's
 * shift has not happened yet and nagging about it would train the
 * operator to ignore the warning.
 */
export function findUnrecordedShifts(
  rows: ShiftRow[],
  today: string,
): UnrecordedShift[] {
  const byDate = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.date || !r.shift) continue;
    const set = byDate.get(r.date) ?? new Set<string>();
    set.add(r.shift);
    byDate.set(r.date, set);
  }

  const out: UnrecordedShift[] = [];
  for (const [date, shifts] of byDate) {
    if (date >= today) continue;
    if (shifts.size === 0) continue;
    for (const s of SHIFTS) {
      if (!shifts.has(s)) out.push({ date, shift: s });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

/** Local YYYY-MM-DD, without the UTC shift `toISOString` would apply. */
export function todayISO(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Load unrecorded shifts from the database.
 * @param from  YYYY-MM-DD, inclusive. Keeps the check off ancient history.
 * @param to    YYYY-MM-DD, inclusive.
 */
export async function loadUnrecordedShifts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  from: string,
  to: string,
): Promise<UnrecordedShift[]> {
  const { data } = await supabase
    .from('attendance_day')
    .select('attendance_date, shift')
    .gte('attendance_date', from)
    .lte('attendance_date', to);
  const rows = ((data ?? []) as Array<{ attendance_date: string; shift: string }>)
    .map((r) => ({ date: r.attendance_date, shift: r.shift }));
  return findUnrecordedShifts(rows, todayISO());
}

/** "Night shift, Sat 22 Aug" — for banners and notification titles. */
export function describeShift(u: UnrecordedShift): string {
  const d = new Date(u.date + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (Number.isNaN(d.getTime())) return `${u.shift} shift, ${u.date}`;
  const label = u.shift === 'night' ? 'Night' : 'Morning';
  return `${label} shift, ${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}
