import { describe, it, expect } from 'vitest';
import { weekStartsBetween } from './weaver-range-data';

/**
 * The week split is the whole report's skeleton: get it wrong and every
 * weaver's figures land against the wrong week, or a week vanishes.
 *
 * Postgres date_trunc('week') is Monday-based, and so is mondayISO, so the
 * weeks listed here must line up with the SQL that verifies the totals.
 */
describe('weekStartsBetween', () => {
  it('lists the Mondays covering the range, verified against SQL', () => {
    // The same window used to check the figures by hand: three ISO weeks.
    expect(weekStartsBetween('2026-08-10', '2026-08-30'))
      .toEqual(['2026-08-10', '2026-08-17', '2026-08-24']);
  });

  it('includes the week containing a mid-week start date', () => {
    // Thursday 13 Aug belongs to the week beginning Monday 10 Aug, and
    // that whole week must appear or its earlier days go missing.
    expect(weekStartsBetween('2026-08-13', '2026-08-19'))
      .toEqual(['2026-08-10', '2026-08-17']);
  });

  it('a single day still yields its week', () => {
    expect(weekStartsBetween('2026-09-02', '2026-09-02')).toEqual(['2026-08-31']);
  });

  it('a Monday-to-Sunday range is exactly one week', () => {
    expect(weekStartsBetween('2026-08-31', '2026-09-06')).toEqual(['2026-08-31']);
  });

  it('adding one day to that range pulls in the next week', () => {
    expect(weekStartsBetween('2026-08-31', '2026-09-07'))
      .toEqual(['2026-08-31', '2026-09-07']);
  });

  it('crosses a month and a year boundary without dropping a week', () => {
    expect(weekStartsBetween('2026-12-28', '2027-01-10'))
      .toEqual(['2026-12-28', '2027-01-04']);
  });

  it('a reversed range yields nothing rather than looping forever', () => {
    expect(weekStartsBetween('2026-09-02', '2026-08-10')).toEqual([]);
  });

  it('a long range is capped rather than running away', () => {
    // Guards against a malformed date producing millions of iterations.
    const weeks = weekStartsBetween('1990-01-01', '2090-01-01');
    expect(weeks.length).toBeLessThanOrEqual(521);
  });
});
