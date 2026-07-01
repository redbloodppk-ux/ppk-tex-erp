import { describe, it, expect } from 'vitest';
import {
  computeWinderAllocation,
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

  it('docks an absent winder when nobody covered her sheds', () => {
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
    const docked = 2 * 2 * RATE;

    expect(res.get(MALIGA)!.book).toBeCloseTo(WEEKLY - docked, 6);
    expect(res.get(MALIGA)!.reallocatedOut).toBeCloseTo(0, 6);
    expect(res.get(KAMACHI)!.book).toBeCloseTo(WEEKLY, 6); // unchanged
    // Wage bill shrinks — money is genuinely docked, not moved.
    const total = res.get(MALIGA)!.book + res.get(KAMACHI)!.book;
    expect(total).toBeCloseTo(2 * WEEKLY - docked, 6);
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
