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
 * THE DEADLINE — verified against the Income Tax Department, 2026-08-29
 * "Tax deducted during the month of April to February should be paid to
 *  the credit of the Government on or before 7 days from the end of the
 *  month in which the deduction is made. Tax deducted during the month of
 *  March should be paid on or before 30th day of April."
 *   https://www.incometaxindia.gov.in/w/interest-for-delay-in-payment-of
 *   -tds/tcs-and-for-non-payment-of-tax-demanded  (as amended by the
 *   Finance Act, 2026)
 *
 * So: the 7th of the following month, EXCEPT March, which gets until
 * 30 April. This was built as the 5th on 2026-08-29 because that is what
 * PPK said and neither of us checked. Two days out every month, and March
 * would have been flagged overdue three weeks early every year. Corrected
 * the same day once the department's page was actually read.
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
  /** ISO date it must be paid by — the 7th of the following month, or
   *  30 April for March deductions. See `dueDateFor`. */
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

/**
 * Statutory deadline for a month's deductions (YYYY-MM in, ISO date out).
 *
 * Seven days from the end of the month, so the 7th of the next one —
 * except MARCH, where the Act allows until 30 April rather than 7 April.
 * March is the financial year end; treating it like every other month
 * would raise a false alarm three weeks early, every year.
 */
export function dueDateFor(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const year = y ?? 0;
  const mon = m ?? 1;
  if (mon === 3) return `${year}-04-30`;          // March -> 30 April
  const nextYear = mon === 12 ? year + 1 : year;  // December -> 7 January
  const nextMonth = mon === 12 ? 1 : mon + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-07`;
}

/**
 * Financial year a deduction month falls in, as "2026-27".
 * India's FY runs April to March, so January 2027 is still FY 2026-27.
 */
export function financialYearOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const startYear = (m ?? 1) >= 4 ? (y ?? 0) : (y ?? 0) - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Assessment year for the challan, as "2027-28" — always the year after
 * the financial year.
 *
 * The portal asks for this and getting it wrong parks the payment against
 * the wrong year, which is tedious to unpick. Verified against PPK's
 * challan of 06-Jan-2026: deduction in Oct-Dec 2025 is FY 2025-26 and the
 * receipt reads AY 2026-27.
 */
export function assessmentYearOf(month: string): string {
  const fyStart = Number(financialYearOf(month).slice(0, 4));
  return `${fyStart + 1}-${String((fyStart + 2) % 100).padStart(2, '0')}`;
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
