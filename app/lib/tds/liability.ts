/**
 * TDS withheld from suppliers, grouped into the monthly liabilities that
 * get remitted to the government.
 *
 * HOW PPK ACTUALLY PAYS (his words, 2026-08-29)
 *   "i pay only 14461 to nithiya sizing and i pay 281 separately to
 *    government portal"
 * So a bill of Rs 14,742 with 2% TDS on charges settles as two payments:
 * Rs 14,461.20 to the mill and Rs 280.80 to the government. The mill's
 * outstanding must drop by the full Rs 14,742 when both are done - which
 * is why the TDS has to be tracked as its own liability rather than left
 * inside the supplier balance.
 *
 * THE DEADLINE
 * TDS deducted in a month is due by the 5th of the NEXT month. August's
 * deductions are due 5 September.
 *
 * THE INTEREST — read this before changing it
 * Section 201(1A): 1.5% per month or PART of a month, running from the
 * date of DEDUCTION to the date of payment. Not from the due date. That
 * one-month difference is why PPK's own examples read the way they do:
 *
 *   April  Rs 321.98 deducted 16-Apr, still unpaid in August
 *          -> Apr, May, Jun, Jul, Aug = 5 months -> 321.98 x 1.5% x 5
 *   May    Rs 617.08 (two bills), still unpaid in August
 *          -> May, Jun, Jul, Aug = 4 months -> 617.08 x 1.5% x 4
 *
 * Counting from the DUE date instead would give 4 and 3, understating the
 * interest on every single row. A part month counts as a whole one, so the
 * count is a difference of calendar months, never of days.
 *
 * Interest applies only once the deadline has actually passed. A month
 * still within its window shows zero, not one month.
 */

/** One bill that had tax withheld from it. */
export interface TdsSource {
  /** Anything identifying the bill to a human — bill_no is ideal. */
  ref: string;
  /** ISO date the tax was deducted, i.e. the bill date. */
  deductedOn: string;
  /** Rupees withheld. */
  amount: number;
  /** Who it was withheld from, for the drill-down. */
  partyName: string;
}

/** A TDS payment already made to the government. */
export interface TdsRemittance {
  /** The month the payment covers, as YYYY-MM. */
  periodMonth: string;
  amount: number;
}

export interface TdsMonth {
  /** YYYY-MM the tax was deducted in. */
  month: string;
  /** "August 2026" */
  label: string;
  /** ISO date it must be paid by — the 5th of the following month. */
  dueDate: string;
  /** Total withheld in the month. */
  tds: number;
  /** Already remitted for this month. */
  paid: number;
  /** Still owed, before interest. */
  outstanding: number;
  /** Whole/part months counted for interest; 0 when not yet overdue. */
  interestMonths: number;
  /** 1.5% x interestMonths x outstanding. */
  interest: number;
  /** outstanding + interest. */
  payable: number;
  overdue: boolean;
  sources: TdsSource[];
}

/** Section 201(1A). */
export const TDS_INTEREST_PCT_PER_MONTH = 1.5;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** YYYY-MM of an ISO date. */
export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/** The 5th of the month after `month` (YYYY-MM). */
export function dueDateFor(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const year = (m ?? 1) === 12 ? (y ?? 0) + 1 : (y ?? 0);
  const nextMonth = (m ?? 1) === 12 ? 1 : (m ?? 1) + 1;
  return `${year}-${String(nextMonth).padStart(2, '0')}-05`;
}

export function labelFor(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1] ?? month} ${y ?? ''}`;
}

/** Whole calendar months between two YYYY-MM values, inclusive of both. */
function monthsInclusive(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0)) + 1;
}

/**
 * Build the monthly TDS position.
 *
 * @param sources     Every bill that had tax withheld.
 * @param remittances Payments already made, keyed by the month they cover.
 * @param today       ISO date to judge lateness from. Passed in rather
 *                    than read from the clock so the tests are stable and
 *                    a report can be run "as at" any date.
 */
export function buildTdsMonths(
  sources: TdsSource[],
  remittances: TdsRemittance[],
  today: string,
): TdsMonth[] {
  const byMonth = new Map<string, TdsSource[]>();
  for (const s of sources) {
    if (!s.deductedOn || !(s.amount > 0)) continue;
    const m = monthOf(s.deductedOn);
    byMonth.set(m, [...(byMonth.get(m) ?? []), s]);
  }

  const paidByMonth = new Map<string, number>();
  for (const r of remittances) {
    paidByMonth.set(r.periodMonth, (paidByMonth.get(r.periodMonth) ?? 0) + Number(r.amount ?? 0));
  }

  const out: TdsMonth[] = [];
  for (const [month, rows] of byMonth) {
    const tds = round2(rows.reduce((t, r) => t + r.amount, 0));
    const paid = round2(paidByMonth.get(month) ?? 0);
    const outstanding = round2(Math.max(0, tds - paid));
    const dueDate = dueDateFor(month);
    const overdue = outstanding > 0.005 && today > dueDate;

    // From the month of DEDUCTION to the current month, both counted.
    const interestMonths = overdue ? Math.max(1, monthsInclusive(month, monthOf(today))) : 0;
    const interest = round2(outstanding * (TDS_INTEREST_PCT_PER_MONTH / 100) * interestMonths);

    out.push({
      month,
      label: labelFor(month),
      dueDate,
      tds,
      paid,
      outstanding,
      interestMonths,
      interest,
      payable: round2(outstanding + interest),
      overdue,
      sources: [...rows].sort((a, b) => a.deductedOn.localeCompare(b.deductedOn)),
    });
  }

  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Totals across every month still owing. */
export function totalTdsPayable(months: TdsMonth[]): {
  outstanding: number; interest: number; payable: number;
} {
  return {
    outstanding: round2(months.reduce((t, m) => t + m.outstanding, 0)),
    interest:    round2(months.reduce((t, m) => t + m.interest, 0)),
    payable:     round2(months.reduce((t, m) => t + m.payable, 0)),
  };
}
