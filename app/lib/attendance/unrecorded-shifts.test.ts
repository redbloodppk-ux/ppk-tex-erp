import { describe, it, expect } from 'vitest';
import {
  findUnrecordedShifts,
  describeShift,
  todayISO,
  type ShiftRow,
} from './unrecorded-shifts';

const TODAY = '2026-08-24';

describe('findUnrecordedShifts', () => {
  it('flags a day whose night shift was never recorded', () => {
    // The real 22 Aug: morning marked, night never created.
    const rows: ShiftRow[] = [{ date: '2026-08-22', shift: 'morning' }];
    expect(findUnrecordedShifts(rows, TODAY)).toEqual([
      { date: '2026-08-22', shift: 'night' },
    ]);
  });

  it('says nothing when both shifts exist', () => {
    const rows: ShiftRow[] = [
      { date: '2026-08-21', shift: 'morning' },
      { date: '2026-08-21', shift: 'night' },
    ];
    expect(findUnrecordedShifts(rows, TODAY)).toEqual([]);
  });

  it('counts a holiday row as recorded', () => {
    // A Sunday night marked non-working IS an answer. Only a missing row
    // is a question. `is_working` is not even selected for this reason.
    const rows: ShiftRow[] = [
      { date: '2026-08-23', shift: 'morning' },
      { date: '2026-08-23', shift: 'night' },
    ];
    expect(findUnrecordedShifts(rows, TODAY)).toEqual([]);
  });

  it('ignores today and anything after it', () => {
    // Tonight has not happened yet. Warning about it would teach the
    // operator to ignore the warning.
    const rows: ShiftRow[] = [
      { date: TODAY, shift: 'morning' },
      { date: '2026-08-25', shift: 'morning' },
    ];
    expect(findUnrecordedShifts(rows, TODAY)).toEqual([]);
  });

  it('ignores a day with no rows at all', () => {
    // The mill was shut and nobody opened the screen. The signal we want
    // is the asymmetry, not silence.
    expect(findUnrecordedShifts([], TODAY)).toEqual([]);
  });

  it('finds the four real gaps, newest first', () => {
    const rows: ShiftRow[] = [];
    for (const d of ['2026-07-18', '2026-07-24', '2026-08-12', '2026-08-22']) {
      rows.push({ date: d, shift: 'morning' });
    }
    rows.push({ date: '2026-08-21', shift: 'morning' });
    rows.push({ date: '2026-08-21', shift: 'night' });

    const found = findUnrecordedShifts(rows, TODAY);
    expect(found.map((f) => f.date)).toEqual([
      '2026-08-22', '2026-08-12', '2026-07-24', '2026-07-18',
    ]);
    expect(found.every((f) => f.shift === 'night')).toBe(true);
  });

  it('flags a missing MORNING too, not just nights', () => {
    const rows: ShiftRow[] = [{ date: '2026-08-20', shift: 'night' }];
    expect(findUnrecordedShifts(rows, TODAY)).toEqual([
      { date: '2026-08-20', shift: 'morning' },
    ]);
  });
});

describe('describeShift', () => {
  it('reads as a sentence', () => {
    expect(describeShift({ date: '2026-08-22', shift: 'night' }))
      .toBe('Night shift, Sat 22 Aug');
  });
});

describe('todayISO', () => {
  it('uses local date, not UTC', () => {
    // 1 Jan 2026 at 00:30 local. toISOString() would report 31 Dec in
    // any timezone east of UTC, which is every Indian one.
    expect(todayISO(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });
});
