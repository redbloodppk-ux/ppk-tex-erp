/**
 * Winder weekly wage allocation with substitute reallocation.
 *
 * Business rule (July 2026): a winder is paid per shed she is assigned,
 * per working shift-slot in the week. Her per-slot rate is
 *   weekly_salary / (assigned sheds * working shift-slots in the week).
 *
 * For every (assigned shed, working slot):
 *   - Weaver absent/none in that shed-slot  -> nobody is paid (docked).
 *   - Weaver present, winder NOT absent      -> credited to the winder
 *     (present / half_day / late / early_leave / none — a winder is on
 *     the hook for both shifts of every shed she covers).
 *   - Weaver present, winder ABSENT, a substitute winder covered that
 *     shed that slot -> the money MOVES from the absent winder to the
 *     substitute.
 *   - Weaver present, winder ABSENT, nobody covered -> docked.
 *
 * The total wage bill is conserved: rupees removed from an absent winder
 * are exactly the rupees handed to her substitute(s).
 */

/** A winder and the sheds she is responsible for. */
export interface WinderMaster {
  id: number;
  weeklySalary: number;
  /** employee.default_sheds — the sheds this winder is assigned to. */
  assignedSheds: string[];
}

/** One winder's attendance for one working shift-slot. */
export interface WinderSlotAttendance {
  winderId: number;
  /** "YYYY-MM-DD:shift". */
  slotKey: string;
  /** attendance_status: present | absent | half_day | late | early_leave | none. */
  status: string;
  /** Sheds actually covered this slot (attendance_entry.shed_nos). */
  sheds: string[];
}

export interface WinderAllocationInput {
  winders: WinderMaster[];
  /** Every is_working shift-slot in the week, as "YYYY-MM-DD:shift". */
  workingSlotKeys: string[];
  /** One row per winder per slot they have an attendance_entry for. */
  attendance: WinderSlotAttendance[];
  /** Shed-slots where the weaver was absent/none. Keys: "shed:YYYY-MM-DD:shift". */
  weaverGapSlots: Set<string>;
}

export interface WinderAllocationResult {
  /** Final book salary = own retained slots + rupees reallocated in. */
  book: number;
  /** Rupees lost from own salary (weaver gaps + own absences). */
  deduction: number;
  /** Rupees received for covering absent winders' sheds. */
  reallocatedIn: number;
  /** Rupees moved away to substitutes (a subset of `deduction`). */
  reallocatedOut: number;
  /** Assigned shed-slots left unpaid because the weaver was absent. */
  weaverAbsentCount: number;
  /** assignedSheds.length × workingSlotKeys.length. */
  expectedShedSlots: number;
  /** Count of shed-slots this winder covered for an absent winder. */
  coveredForOthers: number;
}

/**
 * Compute each winder's book salary for the week, moving money from
 * absent winders to the substitutes who covered their sheds.
 */
export function computeWinderAllocation(
  input: WinderAllocationInput,
): Map<number, WinderAllocationResult> {
  const { winders, workingSlotKeys, attendance, weaverGapSlots } = input;
  const nSlots = workingSlotKeys.length;

  // Index attendance by winder+slot, and build the per-slot roster of
  // winders who can act as substitutes (present-ish, with sheds covered).
  const attByKey = new Map<string, WinderSlotAttendance>();
  const coverBySlot = new Map<string, Array<{ winderId: number; sheds: Set<string> }>>();
  for (const a of attendance) {
    attByKey.set(`${a.winderId}|${a.slotKey}`, a);
    // 'absent' can't cover; 'none' means not scheduled, so it never
    // provides substitute cover. Everything else counts as present.
    if (a.status !== 'absent' && a.status !== 'none') {
      const list = coverBySlot.get(a.slotKey) ?? [];
      list.push({ winderId: a.winderId, sheds: new Set(a.sheds) });
      coverBySlot.set(a.slotKey, list);
    }
  }

  const rateById = new Map<number, number>();
  const results = new Map<number, WinderAllocationResult>();
  for (const w of winders) {
    const expected = w.assignedSheds.length * nSlots;
    rateById.set(w.id, expected > 0 ? w.weeklySalary / expected : 0);
    results.set(w.id, {
      book: 0,
      deduction: 0,
      reallocatedIn: 0,
      reallocatedOut: 0,
      weaverAbsentCount: 0,
      expectedShedSlots: expected,
      coveredForOthers: 0,
    });
  }

  for (const w of winders) {
    const rate = rateById.get(w.id) ?? 0;
    const res = results.get(w.id);
    if (!res) continue;
    for (const slotKey of workingSlotKeys) {
      const status = attByKey.get(`${w.id}|${slotKey}`)?.status;
      for (const shed of w.assignedSheds) {
        if (weaverGapSlots.has(`${shed}:${slotKey}`)) {
          // Weaver absent -> shed-slot unpaid.
          res.weaverAbsentCount += 1;
          res.deduction += rate;
          continue;
        }
        if (status === 'absent') {
          // Winder absent, weaver present -> hand the money to a substitute.
          res.deduction += rate;
          const subs = (coverBySlot.get(slotKey) ?? []).filter(
            (x) => x.winderId !== w.id && x.sheds.has(shed),
          );
          if (subs.length > 0) {
            res.reallocatedOut += rate;
            const share = rate / subs.length;
            for (const sub of subs) {
              const subRes = results.get(sub.winderId);
              if (!subRes) continue;
              subRes.book += share;
              subRes.reallocatedIn += share;
              subRes.coveredForOthers += 1;
            }
          }
          // else: docked, nobody gains.
        } else {
          // Present / none / half_day / late / early_leave -> credited.
          res.book += rate;
        }
      }
    }
  }

  return results;
}
