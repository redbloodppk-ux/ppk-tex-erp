import { describe, it, expect } from 'vitest';
import {
  computeWinderAllocation,
  deriveWeaverGapSlots,
  type WeaverShedRow,
  type WinderAllocationInput,
  type WinderSlotAttendance,
} from './winder-allocation';

/**
 * Scenario mirrors the real shop floor:
 *   KAMACHI (id 9) — sheds ["1","3"], ₹4000/week, morning
 *   MALIGA  (id 10) — sheds ["2","4"], ₹4000/week, morning
 * Week has 11 working morning slots (holiday excluded).
 * Both winders' rate = 4000 / (2 sheds × 11 slots) = ₹181.818.../shed-slot.
 */
const KAMACHI = 9;
const MALIGA = 10;
const WEEKLY = 4000;

function slotKeys(n: number): string[] {
  // 11 morning slots across two weeks so counts are unambiguous.
  const keys: string[] = [];
  for (let i = 1; i <= n; i++) {
    const day = String(i).padStart(2, '0');
    keys.push(`2026-06-${day}:morning`);
  }
  return keys;
}

const RATE = WEEKLY / (2 * 11); // 181.8181...

describe('computeWinderAllocation', () => {
  it('full attendance week pays each winder exactly her full salary', () => {
    const workingSlotKeys = slotKeys(11);
    const attendance: WinderSlotAttendance[] = [];
    for (const k of workingSlotKeys) {
      attendance.push({ winderId: KAMACHI, slotKey: k, status: 'present', sheds: ['1', '3'] });
      attendance.push({ winderId: MALIGA, slotKey: k, status: 'present', sheds: ['2', '4'] });
    }

    const input: WinderAllocationInput = {
      winders: [
        { id: KAMACHI, weeklySalary: WEEKLY, assignedSheds: ['1', '3'] },
        { id: MALIGA, weeklySalary: WEEKLY, assignedSheds: ['2', '4'] },
      ],
      workingSlotKeys,
      attendance,
      weaverGapSlots: new Set(),
    };

    const res = computeWinderAllocation(input);
    expect(res.get(KAMACHI)!.book).toBeCloseTo(WEEKLY, 6);
    expect(res.get(MALIGA)!.book).toBeCloseTo(WEEKLY, 6);
    expect(res.get(KAMACHI)!.deduction).toBeCloseTo(0, 6);
    expect(res.get(MALIGA)!.deduction).toBeCloseTo(0, 6);
  });

  it('moves an absent winder\'s money to the substitute who covered her sheds', () => {
    const workingSlotKeys = slotKeys(11);
    const absentSlots = new Set(workingSlotKeys.slice(0, 3)); // MALIGA absent 3 mornings
    const attendance: WinderSlotAttendance[] = [];
    for (const k of workingSlotKeys) {
      if (absentSlots.has(k)) {
        // MALIGA absent; KAMACHI covers all four sheds those mornings.
        attendance.push({ winderId: MALIGA, slotKey: k, status: 'absent', sheds: [] });
        attendance.push({
          winderId: KAMACHI,
          slotKey: k,
          status: 'present',
          sheds: ['1', '3', '2', '4'],
        });
      } else {
        attendance.push({ winderId: KAMACHI, slotKey: k, status: 'present', sheds: ['1', '3'] });
        attendance.push({ winderId: MALIGA, slotKey: k, status: 'present', sheds: ['2', '4'] });
      }
    }

    const input: WinderAllocationInput = {
      winders: [
        { id: KAMACHI, weeklySalary: WEEKLY, assignedSheds: ['1', '3'] },
        { id: MALIGA, weeklySalary: WEEKLY, assignedSheds: ['2', '4'] },
      ],
      workingSlotKeys,
      attendance,
      weaverGapSlots: new Set(),
    };

    const res = computeWinderAllocation(input);
    const moved = 3 * 2 * RATE; // 3 mornings × 2 sheds × rate = 1090.909...

    expect(res.get(MALIGA)!.book).toBeCloseTo(WEEKLY - moved, 6); // 2909.09
    expect(res.get(KAMACHI)!.book).toBeCloseTo(WEEKLY + moved, 6); // 5090.91
    expect(res.get(MALIGA)!.reallocatedOut).toBeCloseTo(moved, 6);
    expect(res.get(KAMACHI)!.reallocatedIn).toBeCloseTo(moved, 6);
    expect(res.get(KAMACHI)!.coveredForOthers).toBe(6);

    // Total wage bill is conserved.
    const total = res.get(MALIGA)!.book + res.get(KAMACHI)!.book;
    expect(total).toBeCloseTo(2 * WEEKLY, 6);
  });

  it('an absent winder keeps her pay when nobody covered her sheds', () => {
    const workingSlotKeys = slotKeys(11);
    const absentSlots = new Set(workingSlotKeys.slice(0, 2));
    const attendance: WinderSlotAttendance[] = [];
    for (const k of workingSlotKeys) {
      if (absentSlots.has(k)) {
        attendance.push({ winderId: MALIGA, slotKey: k, status: 'absent', sheds: [] });
        // KAMACHI only works her own sheds — does NOT cover 2 & 4.
        attendance.push({ winderId: KAMACHI, slotKey: k, status: 'present', sheds: ['1', '3'] });
      } else {
        attendance.push({ winderId: KAMACHI, slotKey: k, status: 'present', sheds: ['1', '3'] });
        attendance.push({ winderId: MALIGA, slotKey: k, status: 'present', sheds: ['2', '4'] });
      }
    }

    const input: WinderAllocationInput = {
      winders: [
        { id: KAMACHI, weeklySalary: WEEKLY, assignedSheds: ['1', '3'] },
        { id: MALIGA, weeklySalary: WEEKLY, assignedSheds: ['2', '4'] },
      ],
      workingSlotKeys,
      attendance,
      weaverGapSlots: new Set(),
    };

    const res = computeWinderAllocation(input);

    // RULE CHANGED 2026-08-24 (PPK). This test previously expected MALIGA
    // to be docked 2 slots x 2 sheds. She no longer is: her sheds RAN on
    // those slots, so the yarn was there and she had wound it ahead. Her
    // own absence costs her nothing when nobody else is on the shed.
    expect(res.get(MALIGA)!.book).toBeCloseTo(WEEKLY, 6);
    expect(res.get(MALIGA)!.deduction).toBeCloseTo(0, 6);
    expect(res.get(MALIGA)!.reallocatedOut).toBeCloseTo(0, 6);
    expect(res.get(KAMACHI)!.book).toBeCloseTo(WEEKLY, 6); // unchanged
    // Nothing is lost: the full wage bill is still paid.
    const total = res.get(MALIGA)!.book + res.get(KAMACHI)!.book;
    expect(total).toBeCloseTo(2 * WEEKLY, 6);
  });

  it('docks (no reallocation) when the weaver is absent in a shed-slot', () => {
    const workingSlotKeys = slotKeys(11);
    const attendance: WinderSlotAttendance[] = [];
    for (const k of workingSlotKeys) {
      attendance.push({ winderId: KAMACHI, slotKey: k, status: 'present', sheds: ['1', '3'] });
      attendance.push({ winderId: MALIGA, slotKey: k, status: 'present', sheds: ['2', '4'] });
    }
    // Weaver absent in shed 2 on the first morning only.
    const weaverGapSlots = new Set([`2:${workingSlotKeys[0]}`]);

    const input: WinderAllocationInput = {
      winders: [
        { id: KAMACHI, weeklySalary: WEEKLY, assignedSheds: ['1', '3'] },
        { id: MALIGA, weeklySalary: WEEKLY, assignedSheds: ['2', '4'] },
      ],
      workingSlotKeys,
      attendance,
      weaverGapSlots,
    };

    const res = computeWinderAllocation(input);
    expect(res.get(MALIGA)!.book).toBeCloseTo(WEEKLY - RATE, 6);
    expect(res.get(MALIGA)!.weaverAbsentCount).toBe(1);
    expect(res.get(MALIGA)!.reallocatedOut).toBeCloseTo(0, 6);
    expect(res.get(KAMACHI)!.book).toBeCloseTo(WEEKLY, 6);
  });
});

/**
 * Regression: the week of 17-23 Aug 2026, reproduced from the live
 * attendance rows.
 *
 * MALIGA (sheds 2 and 4) was shown 9 weaver-absent out of 24 and docked
 * Rs 1,650 of her Rs 4,400. Seven of those nine sheds were being woven at
 * the time — by ACTING 1 and RAVI on shed 4 nights, and by VIJI and
 * SUBRAMANI on shed 2. What made them look empty was ASHOK, a MORNING
 * weaver whose shed-4 row also exists on every night, marked `none`.
 *
 * Only 23-Aug morning is a true gap on each shed: nobody at all.
 */
describe('deriveWeaverGapSlots', () => {
  const NIGHTS = ['17', '18', '19', '20', '21'].map((d) => `2026-08-${d}:night`);

  it("a morning weaver's stale night row does not empty a shed someone wove", () => {
    const rows: WeaverShedRow[] = [];
    for (const slotKey of NIGHTS) {
      rows.push({ shed: '4', slotKey, status: 'none' });     // ASHOK, not rostered
      rows.push({ shed: '4', slotKey, status: 'present' });  // ACTING 1 / RAVI
    }
    const gaps = deriveWeaverGapSlots(rows);
    expect(gaps.size).toBe(0);
  });

  it('a shed nobody wove IS a gap', () => {
    const gaps = deriveWeaverGapSlots([
      { shed: '2', slotKey: '2026-08-23:morning', status: 'absent' },
      { shed: '4', slotKey: '2026-08-23:morning', status: 'absent' },
    ]);
    expect(gaps).toEqual(new Set(['2:2026-08-23:morning', '4:2026-08-23:morning']));
  });

  it('early leave still counts as woven — the shed ran', () => {
    const gaps = deriveWeaverGapSlots([
      { shed: '2', slotKey: '2026-08-22:morning', status: 'early_leave' }, // SUBRAMANI
      { shed: '2', slotKey: '2026-08-22:morning', status: 'none' },        // VIJI
    ]);
    expect(gaps.size).toBe(0);
  });

  it('MALIGA week 17-23 Aug: 2 real gaps, not 9', () => {
    const rows: WeaverShedRow[] = [];
    // Shed 4 nights — ASHOK stale `none`, someone else present.
    for (const slotKey of NIGHTS) {
      rows.push({ shed: '4', slotKey, status: 'none' });
      rows.push({ shed: '4', slotKey, status: 'present' });
    }
    // Shed 2, 18-Aug night — SUBRAMANI `none`, VIJI present.
    rows.push({ shed: '2', slotKey: '2026-08-18:night', status: 'none' });
    rows.push({ shed: '2', slotKey: '2026-08-18:night', status: 'present' });
    // Shed 2, 22-Aug morning — VIJI `none`, SUBRAMANI left early.
    rows.push({ shed: '2', slotKey: '2026-08-22:morning', status: 'none' });
    rows.push({ shed: '2', slotKey: '2026-08-22:morning', status: 'early_leave' });
    // 23-Aug morning — genuinely nobody, on both sheds.
    rows.push({ shed: '2', slotKey: '2026-08-23:morning', status: 'absent' });
    rows.push({ shed: '4', slotKey: '2026-08-23:morning', status: 'absent' });

    const gaps = deriveWeaverGapSlots(rows);
    expect(gaps).toEqual(new Set(['2:2026-08-23:morning', '4:2026-08-23:morning']));

    // ...and what that is worth to her.
    const WEEK = 4400;
    const expectedShedSlots = 2 * 12; // 2 sheds x 12 working slots
    const rate = WEEK / expectedShedSlots;
    expect(rate * gaps.size).toBeCloseTo(366.67, 2);   // was 1650.00
    expect(WEEK - rate * gaps.size).toBeCloseTo(4033.33, 2); // was 2750.00
  });
});

/**
 * A winder who stops coming to work must stop earning.
 *
 * Nobody creates attendance rows for someone who has left, so before
 * 2026-08-23 the absence of a row fell through to the credit branch and
 * paid her in full. PACHAIYAMAAL left after two days in July 2026; the
 * algorithm would have handed her a near-full week.
 */
describe('computeWinderAllocation — missing attendance rows', () => {
  const PACHAIYAMAAL = 32;
  const MALIGA_ID = 10;
  const SLOTS = ['a', 'b', 'c', 'd'].map((s) => `2026-07-2${s === 'a' ? 0 : s === 'b' ? 1 : s === 'c' ? 2 : 3}:morning`);

  it('a slot with no row earns nothing', () => {
    const result = computeWinderAllocation({
      winders: [{ id: PACHAIYAMAAL, weeklySalary: 2200, assignedSheds: ['4'] }],
      workingSlotKeys: SLOTS,
      // Present for the first slot only; the other three have no row.
      attendance: [
        { winderId: PACHAIYAMAAL, slotKey: SLOTS[0]!, status: 'present', sheds: ['4'] },
      ],
      weaverGapSlots: new Set(),
    });
    const r = result.get(PACHAIYAMAAL);
    expect(r?.book).toBeCloseTo(2200 / 4, 2); // one slot of four
    expect(r?.deduction).toBeCloseTo((2200 / 4) * 3, 2);
  });

  it('a missing row hands the shed to whoever actually covered it', () => {
    const result = computeWinderAllocation({
      winders: [
        { id: PACHAIYAMAAL, weeklySalary: 2200, assignedSheds: ['4'] },
        { id: MALIGA_ID, weeklySalary: 4400, assignedSheds: ['2', '4'] },
      ],
      workingSlotKeys: [SLOTS[0]!],
      // PACHAIYAMAAL has no row at all. MALIGA is there, covering shed 4.
      attendance: [
        { winderId: MALIGA_ID, slotKey: SLOTS[0]!, status: 'present', sheds: ['2', '4'] },
      ],
      weaverGapSlots: new Set(),
    });
    const gone = result.get(PACHAIYAMAAL);
    const there = result.get(MALIGA_ID);
    expect(gone?.book).toBeCloseTo(0, 2);
    expect(gone?.reallocatedOut).toBeCloseTo(2200, 2); // her whole rate moves
    expect(there?.reallocatedIn).toBeCloseTo(2200, 2);
    expect(there?.coveredForOthers).toBe(1);
  });
});

/**
 * Confirmed cover (migration 264) and the "absence never docks" rule
 * agreed with PPK on 2026-08-24.
 */
describe('computeWinderAllocation — cover records and absence', () => {
  const KAM = 9;
  const MAL = 10;
  const SLOT = '2026-08-23:morning';

  const base = {
    workingSlotKeys: [SLOT],
    weaverGapSlots: new Set<string>(),
  };

  it('an absent winder KEEPS her box when nobody else is on the shed', () => {
    // The real 23 Aug: sheds 1 and 3 ran (ANAND, SURESH A weaving) with no
    // winder on the floor. KAMACHI had wound ahead.
    const r = computeWinderAllocation({
      ...base,
      winders: [{ id: KAM, weeklySalary: 4000, assignedSheds: ['1', '3'] }],
      attendance: [{ winderId: KAM, slotKey: SLOT, status: 'absent', sheds: ['1', '3'] }],
    }).get(KAM);
    expect(r?.book).toBeCloseTo(4000, 2);
    expect(r?.deduction).toBeCloseTo(0, 2);
  });

  it('but a shed with no weaver still pays nobody', () => {
    const r = computeWinderAllocation({
      ...base,
      weaverGapSlots: new Set([`1:${SLOT}`]),
      winders: [{ id: KAM, weeklySalary: 4000, assignedSheds: ['1', '3'] }],
      attendance: [{ winderId: KAM, slotKey: SLOT, status: 'absent', sheds: ['1', '3'] }],
    }).get(KAM);
    expect(r?.book).toBeCloseTo(2000, 2);
    expect(r?.weaverAbsentCount).toBe(1);
  });

  it('a confirmed coverer overrides the guess', () => {
    // The guess would hand shed 4 to MALIGA, whose card lists it by default.
    // The supervisor confirmed KAMACHI took it instead.
    const res = computeWinderAllocation({
      ...base,
      winders: [
        { id: MAL, weeklySalary: 2400, assignedSheds: ['4'] },
        { id: KAM, weeklySalary: 4000, assignedSheds: ['1', '3'] },
      ],
      attendance: [
        { winderId: MAL, slotKey: SLOT, status: 'absent', sheds: ['4'] },
        { winderId: KAM, slotKey: SLOT, status: 'present', sheds: ['1', '3', '4'] },
      ],
      coverRecords: new Map([[`${MAL}|4|${SLOT}`, { outcome: 'covered' as const, coveredBy: KAM }]]),
    });
    expect(res.get(MAL)?.book).toBeCloseTo(0, 2);
    expect(res.get(KAM)?.reallocatedIn).toBeCloseTo(2400, 2);
    // Conserved: what left MALIGA is exactly what reached KAMACHI.
    expect(res.get(MAL)?.reallocatedOut).toBeCloseTo(res.get(KAM)?.reallocatedIn ?? -1, 2);
  });

  it('"she wound ahead" keeps the box with her, overriding a guessed coverer', () => {
    const res = computeWinderAllocation({
      ...base,
      winders: [
        { id: MAL, weeklySalary: 2400, assignedSheds: ['4'] },
        { id: KAM, weeklySalary: 4000, assignedSheds: ['1', '3'] },
      ],
      attendance: [
        { winderId: MAL, slotKey: SLOT, status: 'absent', sheds: ['4'] },
        // KAMACHI is present holding shed 4, so the GUESS would move the
        // money to her. The confirmed answer says otherwise.
        { winderId: KAM, slotKey: SLOT, status: 'present', sheds: ['1', '3', '4'] },
      ],
      coverRecords: new Map([[`${MAL}|4|${SLOT}`, { outcome: 'wound_ahead' as const, coveredBy: null }]]),
    });
    expect(res.get(MAL)?.book).toBeCloseTo(2400, 2);
    expect(res.get(MAL)?.woundAheadCount).toBe(1);
    expect(res.get(KAM)?.reallocatedIn).toBeCloseTo(0, 2);
  });

  it('no record at all reproduces the old guess', () => {
    const res = computeWinderAllocation({
      ...base,
      winders: [
        { id: MAL, weeklySalary: 2400, assignedSheds: ['4'] },
        { id: KAM, weeklySalary: 4000, assignedSheds: ['1', '3'] },
      ],
      attendance: [
        { winderId: MAL, slotKey: SLOT, status: 'absent', sheds: ['4'] },
        { winderId: KAM, slotKey: SLOT, status: 'present', sheds: ['1', '3', '4'] },
      ],
    });
    expect(res.get(MAL)?.book).toBeCloseTo(0, 2);
    expect(res.get(KAM)?.reallocatedIn).toBeCloseTo(2400, 2);
  });

  it('a winder who has LEFT still earns nothing — no row is not absence', () => {
    // The two rules could collide here: "absence never docks" must not
    // resurrect PACHAIYAMAAL, who has no attendance rows at all.
    const GONE = 32;
    const res = computeWinderAllocation({
      ...base,
      workingSlotKeys: [SLOT, '2026-08-23:night'],
      winders: [{ id: GONE, weeklySalary: 2200, assignedSheds: ['4'] }],
      attendance: [],
    }).get(GONE);
    expect(res?.book).toBeCloseTo(0, 2);
    expect(res?.deduction).toBeCloseTo(2200, 2);
  });
});
