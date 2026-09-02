/**
 * Weaver wages across a date range, one row per weaver per week.
 *
 * PPK, 2026-09-02: "we need available date range download option for Weaver
 * Wages only". The Weekly Wage Summary is locked to one week at a time,
 * which is right for paying people and useless for looking back over a
 * season.
 *
 * WHY THIS CALLS buildWeeklyWageData IN A LOOP
 * It would be faster to fetch every shift log in the range in one query and
 * group by week. It would also be a SECOND implementation of "what a weaver
 * earned", sitting beside the one the screen uses — and the two would agree
 * right up until somebody changed one of them.
 *
 * That is not hypothetical here. The fitter wage read Rs 2,400 on the screen
 * and Rs 4,000 in the export for exactly that reason, and it went unnoticed
 * for weeks because both numbers looked plausible. Withheld TDS managed
 * three different values across four screens the same week.
 *
 * So this export earns nothing on its own. It asks the weekly builder, once
 * per week, and reports what it says. If a wage rule changes, this follows
 * without being touched. The cost is one round of queries per week in the
 * range — slower, and worth it.
 */
import {
  buildWeeklyWageData,
  mondayISO,
  addDaysISO,
  type PerWorkerRow,
} from './weekly-data';

export interface WeaverWeekRow {
  week_start: string;
  week_end: string;
  employee_id: number;
  code: string;
  full_name: string;
  wages_earned: number;
  wages_paid: number;
  advances: number;
  adjustments: number;
  extra_work: number;
  net_payable: number;
}

export interface WeaverTotalRow {
  employee_id: number;
  code: string;
  full_name: string;
  weeks: number;
  wages_earned: number;
  wages_paid: number;
  advances: number;
  adjustments: number;
  extra_work: number;
  net_payable: number;
}

export interface WeaverRangeData {
  from: string;
  to: string;
  /** Mondays actually covered, ascending. */
  weeks: string[];
  rows: WeaverWeekRow[];
  /** One line per weaver, summed across the range. */
  totals: WeaverTotalRow[];
  grand: Omit<WeaverTotalRow, 'employee_id' | 'code' | 'full_name' | 'weeks'>;
}

/** Every Monday from the week containing `from` to the week containing `to`. */
export function weekStartsBetween(from: string, to: string): string[] {
  const first = mondayISO(new Date(from + 'T00:00:00'));
  const last = mondayISO(new Date(to + 'T00:00:00'));
  const out: string[] = [];
  // Guard against a reversed range rather than looping forever.
  if (last < first) return out;
  for (let w = first; w <= last; w = addDaysISO(w, 7)) {
    out.push(w);
    // 520 weeks is ten years — far past anything real, and a cheap stop
    // if a malformed date ever slips through the caller's validation.
    if (out.length > 520) break;
  }
  return out;
}

const ZERO = {
  wages_earned: 0, wages_paid: 0, advances: 0,
  adjustments: 0, extra_work: 0, net_payable: 0,
};

export async function buildWeaverRangeData(
  from: string,
  to: string,
): Promise<WeaverRangeData> {
  const weeks = weekStartsBetween(from, to);
  const rows: WeaverWeekRow[] = [];

  // Sequential, not Promise.all: each week is itself several queries, and
  // firing 26 weeks at once buries the database for no gain on an export
  // nobody is watching a spinner for.
  for (const w of weeks) {
    const wd = await buildWeeklyWageData(w);
    for (const m of wd.metre_employees as PerWorkerRow[]) {
      // A weaver with nothing at all this week adds a row of zeroes and no
      // information. Skipped so a quiet week does not pad the report.
      const touched =
        m.wages_earned !== 0 || m.wages_paid !== 0 || m.advances !== 0 ||
        m.adjustments !== 0 || m.extra_work !== 0;
      if (!touched) continue;
      rows.push({
        week_start: w,
        week_end: addDaysISO(w, 6),
        employee_id: m.employee_id,
        code: m.code,
        full_name: m.full_name,
        wages_earned: m.wages_earned,
        wages_paid: m.wages_paid,
        advances: m.advances,
        adjustments: m.adjustments,
        extra_work: m.extra_work,
        net_payable: m.net_payable,
      });
    }
  }

  const byEmp = new Map<number, WeaverTotalRow>();
  for (const r of rows) {
    const t = byEmp.get(r.employee_id) ?? {
      employee_id: r.employee_id, code: r.code, full_name: r.full_name,
      weeks: 0, ...ZERO,
    };
    t.weeks += 1;
    t.wages_earned += r.wages_earned;
    t.wages_paid   += r.wages_paid;
    t.advances     += r.advances;
    t.adjustments  += r.adjustments;
    t.extra_work   += r.extra_work;
    t.net_payable  += r.net_payable;
    byEmp.set(r.employee_id, t);
  }

  const totals = Array.from(byEmp.values())
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const grand = totals.reduce((g, t) => ({
    wages_earned: g.wages_earned + t.wages_earned,
    wages_paid:   g.wages_paid   + t.wages_paid,
    advances:     g.advances     + t.advances,
    adjustments:  g.adjustments  + t.adjustments,
    extra_work:   g.extra_work   + t.extra_work,
    net_payable:  g.net_payable  + t.net_payable,
  }), { ...ZERO });

  rows.sort((a, b) =>
    a.full_name.localeCompare(b.full_name) || a.week_start.localeCompare(b.week_start));

  return { from, to, weeks, rows, totals, grand };
}
