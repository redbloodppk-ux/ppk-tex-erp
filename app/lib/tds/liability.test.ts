import { describe, it, expect } from 'vitest';
import {
  buildTdsMonths, totalTdsPayable, dueDateFor, labelFor, monthOf,
  financialYearOf, assessmentYearOf, toPayableRupees,
  type TdsSource,
} from './liability';

/** PPK's five real sizing bills, TDS at 2% on charges before GST. */
const REAL: TdsSource[] = [
  { ref: '57',  deductedOn: '2026-04-16', amount: 321.98, partyName: 'SHRI NITHYA SIZING MILL' },
  { ref: '106', deductedOn: '2026-05-02', amount: 303.62, partyName: 'SHRI NITHYA SIZING MILL' },
  { ref: '178', deductedOn: '2026-05-27', amount: 313.46, partyName: 'SHRI NITHYA SIZING MILL' },
  { ref: '280', deductedOn: '2026-06-30', amount: 301.28, partyName: 'SHRI NITHYA SIZING MILL' },
  { ref: '11',  deductedOn: '2026-08-12', amount: 280.80, partyName: 'SHRI NITHYA SIZING MILL' },
];

const TODAY = '2026-08-29';

describe('due dates — the statutory ones, checked against the department', () => {
  it('is 7 days after the month ends, i.e. the 7th', () => {
    // "Tax deducted during the month of April to February should be paid
    //  ... on or before 7 days from the end of the month."
    expect(dueDateFor('2026-08')).toBe('2026-09-07');
    expect(dueDateFor('2026-04')).toBe('2026-05-07');
  });

  it('gives MARCH until 30 April, not 7 April', () => {
    // Year-end carve-out. Treating March like any other month would flag
    // it overdue three weeks early, every single year.
    expect(dueDateFor('2026-03')).toBe('2026-04-30');
    expect(dueDateFor('2027-03')).toBe('2027-04-30');
  });

  it('still rolls the year over in December', () => {
    expect(dueDateFor('2026-12')).toBe('2027-01-07');
  });

  it('works out the financial and assessment years the portal asks for', () => {
    // Checked against PPK's own challan receipt of 06-Jan-2026: a
    // deduction in Oct-Dec 2025 reads FY 2025-26, AY 2026-27.
    expect(financialYearOf('2025-12')).toBe('2025-26');
    expect(assessmentYearOf('2025-12')).toBe('2026-27');

    // April starts the new FY; March is still the old one.
    expect(financialYearOf('2026-04')).toBe('2026-27');
    expect(financialYearOf('2026-03')).toBe('2025-26');
    // January is late in the FY that began the previous April.
    expect(financialYearOf('2027-01')).toBe('2026-27');
    expect(assessmentYearOf('2026-08')).toBe('2027-28');
  });

  it('labels and months read plainly', () => {
    expect(labelFor('2026-08')).toBe('August 2026');
    expect(monthOf('2026-08-12')).toBe('2026-08');
  });
});

describe('buildTdsMonths — PPK\'s own worked examples', () => {
  const months = buildTdsMonths(REAL, [], TODAY);
  const byMonth = Object.fromEntries(months.map((m) => [m.month, m]));

  it('groups the two May bills into one liability', () => {
    // 303.62 + 313.46 = 617.08 — the figure PPK quoted.
    expect(byMonth['2026-05']?.tds).toBe(617.08);
    expect(byMonth['2026-05']?.sources).toHaveLength(2);
  });

  it('April is 5 months of interest, not 4', () => {
    // "if i didn't pay for april then i pay 321.98*(1.5%*5)"
    // Apr, May, Jun, Jul, Aug — counted from the DEDUCTION month.
    const apr = byMonth['2026-04'];
    expect(apr?.interestMonths).toBe(5);
    expect(apr?.interest).toBe(24.15);          // 321.98 x 1.5% x 5
    expect(apr?.payable).toBe(346.13);
  });

  it('May is 4 months', () => {
    // "617.08*(1.5%*4)"
    const may = byMonth['2026-05'];
    expect(may?.interestMonths).toBe(4);
    expect(may?.interest).toBe(37.02);          // 617.08 x 1.5% x 4
  });

  it('June is 3 months', () => {
    expect(byMonth['2026-06']?.interestMonths).toBe(3);
    expect(byMonth['2026-06']?.interest).toBe(13.56);
  });

  it('August is not yet due, so carries no interest', () => {
    // Deducted 12 Aug, due 7 Sep. On 29 Aug it is not late.
    const aug = byMonth['2026-08'];
    expect(aug?.overdue).toBe(false);
    expect(aug?.interestMonths).toBe(0);
    expect(aug?.interest).toBe(0);
    expect(aug?.payable).toBe(280.80);
  });

  it('July has no bills, so no liability row at all', () => {
    expect(byMonth['2026-07']).toBeUndefined();
  });

  it('totals the whole position', () => {
    const t = totalTdsPayable(months);
    expect(t.outstanding).toBe(1521.14);        // matches the Bills tab total
    expect(t.interest).toBe(74.73);
    expect(t.payable).toBe(1595.87);
  });
});

describe('buildTdsMonths — payment and timing', () => {
  it('a paid month drops out of the liability', () => {
    const months = buildTdsMonths(
      REAL, [{ periodMonth: '2026-04', amount: 321.98 }], TODAY,
    );
    const apr = months.find((m) => m.month === '2026-04');
    expect(apr?.outstanding).toBe(0);
    expect(apr?.interest).toBe(0);
    expect(apr?.overdue).toBe(false);
  });

  it('a part payment leaves the remainder bearing interest', () => {
    const months = buildTdsMonths(
      REAL, [{ periodMonth: '2026-04', amount: 100 }], TODAY,
    );
    const apr = months.find((m) => m.month === '2026-04');
    expect(apr?.outstanding).toBe(221.98);
    expect(apr?.interest).toBe(16.65);          // 221.98 x 1.5% x 5
  });

  it('interest starts the day AFTER the deadline, not on it', () => {
    const onTime = buildTdsMonths(REAL, [], '2026-09-07')
      .find((m) => m.month === '2026-08');
    expect(onTime?.overdue).toBe(false);
    expect(onTime?.interest).toBe(0);

    const oneDayLate = buildTdsMonths(REAL, [], '2026-09-08')
      .find((m) => m.month === '2026-08');
    expect(oneDayLate?.overdue).toBe(true);
    // Aug and Sep — a part month counts whole, so one day late costs two.
    expect(oneDayLate?.interestMonths).toBe(2);
    expect(oneDayLate?.interest).toBe(8.42);    // 280.80 x 1.5% x 2
  });

  it('interest keeps climbing a month at a time', () => {
    const at = (d: string) =>
      buildTdsMonths(REAL, [], d).find((m) => m.month === '2026-04')?.interestMonths;
    expect(at('2026-08-29')).toBe(5);
    expect(at('2026-09-01')).toBe(6);
    expect(at('2027-04-01')).toBe(13);
  });

  it('ignores bills with no amount and never invents a month', () => {
    const months = buildTdsMonths(
      [{ ref: 'x', deductedOn: '2026-04-01', amount: 0, partyName: 'X' }], [], TODAY,
    );
    expect(months).toEqual([]);
  });
});

/**
 * The portal takes whole rupees only. PPK, 2026-09-07: "in portal, we can
 * paid in round figures only not in decimal".
 *
 * August 2026 is the case that forced this: Rs 310.44 withheld, Rs 310 paid,
 * and the month then showed 44 paise owed for ever — a debt that could not
 * be settled, because there is no way to pay 44 paise. Worse, it was on
 * course to start accruing 1.5% interest on that 44 paise.
 */
describe('whole rupees — what the portal will actually accept', () => {
  it('rounds the amount to pay to the nearest rupee', () => {
    expect(toPayableRupees(310.44)).toBe(310);
    expect(toPayableRupees(310.55)).toBe(311);
    expect(toPayableRupees(310.50)).toBe(311);
    expect(toPayableRupees(0.44)).toBe(0);
  });

  it("August's 44 paise no longer reads as owed once Rs 310 is paid", () => {
    const months = buildTdsMonths(
      [{ ref: '11', deductedOn: '2026-08-12', amount: 310.44, partyName: 'SHRI NITHYA SIZING MILL' }],
      [{ periodMonth: '2026-08', amount: 310 }],
      '2026-09-30',
    );
    const aug = months.find((m) => m.month === '2026-08');
    expect(aug?.tds).toBe(310.44);      // the legal figure is untouched
    expect(aug?.paid).toBe(310);
    expect(aug?.outstanding).toBe(0);   // ...but nothing is owed
    expect(aug?.overdue).toBe(false);
    expect(aug?.interest).toBe(0);      // and no interest accrues on it
  });

  it('a real shortfall of a rupee or more is still owed', () => {
    // The tolerance must not become a licence to underpay. One rupee short
    // is a debt; 44 paise is a rounding artefact.
    const months = buildTdsMonths(
      [{ ref: 'x', deductedOn: '2026-08-12', amount: 310.44, partyName: 'P' }],
      [{ periodMonth: '2026-08', amount: 309 }],
      '2026-09-30',
    );
    const aug = months.find((m) => m.month === '2026-08');
    expect(aug?.outstanding).toBe(1.44);
    expect(aug?.overdue).toBe(true);
  });

  it('states the whole-rupee figure to pay alongside the exact one', () => {
    const months = buildTdsMonths(
      [{ ref: 'x', deductedOn: '2026-08-12', amount: 310.44, partyName: 'P' }],
      [],
      '2026-08-20',
    );
    const aug = months.find((m) => m.month === '2026-08');
    expect(aug?.payable).toBe(310.44);        // exact, for the books
    expect(aug?.payableRupees).toBe(310);     // what the portal takes
  });
});
