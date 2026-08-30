/**
 * Winder weekly wage allocation with substitute reallocation.
 *
 * Business rule (July 2026, denominator revised August): a winder is paid
 * per shed she is assigned, per shift-slot in the week. Her per-slot rate
 * is
 *   weekly_salary / (assigned sheds * shift-slots in the WEEK).
 *
 * The week is its standard 13 shifts — every shift but Sunday night, which
 * the mill never runs (attendance_day.counts_in_week). A shift that should
 * have run and did not stays in that denominator and pays nobody; it does
 * not shrink the week. See SHED_SLOT_DENOMINATOR_FROM for why, and for the
 * date this took effect.
 *
 * Whether a shed ran is a stated fact where a supervisor ticked it
 * (`shedStatus`, migration 275) and inferred from weaver rows otherwise.
 *
 * For every (assigned shed, working slot):
 *   - NO weaver wove that shed-slot -> nobody is paid. This is the ONLY
 *     way money is lost. See `deriveWeaverGapSlots`.
 *   - Shed ran, winder NOT absent -> credited to her (present / half_day /
 *     late / early_leave / none — a winder works the morning, and the shed
 *     she winds carries through both shifts of that day).
 *   - Shed ran, winder ABSENT, someone else on that shed -> the money
 *     MOVES from her to whoever covered.
 *   - Shed ran, winder ABSENT, nobody else on that shed -> SHE KEEPS IT.
 *     The shed ran, so the yarn was there: she had wound it ahead on an
 *     earlier overtime shift. Changed 2026-08-24; it used to be docked.
 *   - NIGHT slot after a morning she was marked absent for -> she wound
 *     nothing that day, so the night box has nothing to carry. Whoever is
 *     on the shed that night takes it; if nobody is, nobody is paid. She
 *     does NOT keep it. Applies from NIGHT_FOLLOWS_MORNING_FROM only.
 *   - No attendance row at all for the WINDER -> nothing. She is not on
 *     the roster; she has left. Do not confuse this with being marked
 *     absent. (A blank WEAVER row is a different thing - see
 *     `deriveWeaverGapSlots`.)
 *
 * The total wage bill is conserved: rupees removed from an absent winder
 * are exactly the rupees handed to her substitute(s).
 *
 * Who covered is taken from `winder_cover` when a supervisor confirmed it
 * (migration 264), and otherwise inferred from attendance as before.
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
  /**
   * Shifts that belong to the week but did NOT run — no weavers, power
   * cut, maintenance, festival. They stay in the denominator and pay
   * nobody. See SHED_SLOT_DENOMINATOR_FROM.
   *
   * Optional: omitting it reproduces the pre-2026-08-30 behaviour exactly,
   * which is what keeps settled weeks from moving.
   */
  idleSlotKeys?: string[];
  /**
   * Supervisor-stated shed running status (migration 275), keyed
   * "shed:YYYY-MM-DD:shift" -> did that shed run. A present key OVERRIDES
   * the weaver-row inference in `weaverGapSlots`; a missing key falls back
   * to it, so weeks nobody ticked compute as they always did.
   */
  shedStatus?: Map<string, boolean>;
  /** One row per winder per slot they have an attendance_entry for. */
  attendance: WinderSlotAttendance[];
  /** Shed-slots NO weaver wove. Keys: "shed:YYYY-MM-DD:shift".
   *  Build with `deriveWeaverGapSlots`, never by hand. */
  weaverGapSlots: Set<string>;
  /** Confirmed answers from `winder_cover` (migration 264), keyed
   *  "absentWinderId|shed|slotKey". A missing key means nobody confirmed
   *  anything, and cover is inferred from `attendance` as it always was.
   *  Optional so existing callers and tests keep working. */
  coverRecords?: Map<string, WinderCoverRecord>;
}

/** One supervisor-confirmed answer about an absent winder's shed. */
export interface WinderCoverRecord {
  /** 'covered' - another winder wound it, see coveredBy.
   *  'wound_ahead' - she had wound it herself in advance, on overtime. */
  outcome: 'covered' | 'wound_ahead';
  /** Employee id of the winder who covered; null for 'wound_ahead'. */
  coveredBy: number | null;
}

/**
 * The night-follows-morning rule applies from this date onward.
 *
 * Not a technical limit - a deliberate line. The rule was written on
 * 2026-08-24 and reaches back into history, so it would have re-opened
 * MALIGA's week of 6-12 Jul, settled and PAID at Rs 3,600 on 12 Jul,
 * taking Rs 366.67 off a closed week. PPK chose to leave that week alone.
 *
 * The cutoff sits at the Monday after it, so the only other qualifying
 * slot - PACHAIYAMAAL's 25 Jul, her final unsettled week - is still
 * covered. Two slots in the whole database qualify; this excludes one of
 * them by date rather than by a special case.
 */
const NIGHT_FOLLOWS_MORNING_FROM = '2026-07-13';

/** Statuses that mean a weaver actually stood at the loom.
 *  `early_leave` counts: the shed ran, so the winder earned her slot. */
const WEAVER_WORKED = new Set(['present', 'half_day', 'late', 'early_leave']);

/** One weaver's attendance row for one shed in one working slot. */
export interface WeaverShedRow {
  shed: string;
  /** "YYYY-MM-DD:shift". */
  slotKey: string;
  status: string;
}

/**
 * From this date, a shed with NO weaver row at all counts as idle rather
 * than as "not on the roster".
 *
 * Dated for the same reason as NIGHT_FOLLOWS_MORNING_FROM: the rule was
 * agreed on 2026-08-24 and reaches backwards. Applying it to everything
 * would take Rs 880.00 off KAMACHI in the week of 3 Aug, already settled
 * and paid - shed 1 sat blank on four nights there. The cutoff is this
 * week's Monday, so only unsettled figures move.
 */
const BLANK_SHED_IS_IDLE_FROM = '2026-08-17';

/**
 * From this date, a shift the mill did not run STAYS in the week.
 *
 * PPK, 2026-08-30: "winder kamchi - 12 shift running and 14 non running".
 * The screen said 8 of 20 and he says 14 of 26. Both are right about the
 * shed-slots that ran; they disagree about how big the week is.
 *
 * Until now a non-working shift was dropped from the week altogether, so
 * the three nights of 24-26 Aug that could not run for want of weavers
 * shrank the week from 13 shifts to 10 - and RAISED the box rate from
 * Rs 169.23 to Rs 220.00. Closing the mill made the winders whole for
 * winding they never did.
 *
 * Now the week is its standard 13 shifts (everything but Sunday night,
 * attendance_day.counts_in_week). A shift that should have run and did
 * not is a box that pays nobody. Confirmed by PPK for all four closure
 * reasons - no weavers, power cut, maintenance, national holiday.
 *
 * Dated for the same reason as the two rules above: every week through
 * 23 Aug is settled and paid. This one is the Monday of the first open
 * week, so only unsettled figures move.
 */
const SHED_SLOT_DENOMINATOR_FROM = '2026-08-24';

/** What to consider beyond the rows that exist, when deciding gaps. */
export interface WeaverGapOptions {
  /** Every shed any winder is assigned to. A shed nobody winds is not
   *  worth reasoning about. */
  sheds: string[];
  /** Every working shift-slot in the week, as "YYYY-MM-DD:shift". */
  slotKeys: string[];
}

/**
 * Shed-slots that pay nobody — those where NO weaver was working.
 *
 * WHY THIS IS NOT "some weaver was absent"
 * A shed carries more than one weaver row for the same slot. A weaver who
 * works mornings keeps his shed on the NIGHT rows too, marked `none`. So
 * asking "is any row absent/none?" calls a shed empty while somebody is
 * standing at it, and docks the winder for a shed that ran all night.
 *
 * Found 2026-08-23: 7 of MALIGA's 9 recorded gaps were slots where another
 * weaver was present — ASHOK's stale `none` night rows on shed 4, and
 * SUBRAMANI's on shed 2. It cost her Rs 1,283.33 in a single week. The bug
 * only shows up where two weavers share a shed, which is why KAMACHI's
 * sheds 1 and 3 were unaffected and the error went unnoticed.
 *
 * A shed-slot with no weaver row at all was originally NOT a gap - the
 * shed was taken to be off the roster. From BLANK_SHED_IS_IDLE_FROM that
 * flips: pass `opts` and a blank shed counts as idle, guarded so it only
 * applies to shifts where attendance was marked at all.
 */
export function deriveWeaverGapSlots(
  rows: WeaverShedRow[],
  opts?: WeaverGapOptions,
): Set<string> {
  const seen = new Set<string>();
  const worked = new Set<string>();
  // How many weaver rows each slot carries, used by the safeguard below.
  const rowsPerSlot = new Map<string, number>();
  for (const r of rows) {
    if (!r.shed || !r.slotKey) continue;
    const key = `${r.shed}:${r.slotKey}`;
    seen.add(key);
    rowsPerSlot.set(r.slotKey, (rowsPerSlot.get(r.slotKey) ?? 0) + 1);
    if (WEAVER_WORKED.has(r.status)) worked.add(key);
  }
  const gaps = new Set<string>();
  for (const key of seen) if (!worked.has(key)) gaps.add(key);

  // A shed with no weaver row at all is idle, not unrostered. Agreed with
  // PPK 2026-08-24 after this had to be hand-corrected twice in one day -
  // shed 1 on the nights of 19 and 21 Aug (migration 265), then sheds 1
  // and 3 on 22 Aug night (migration 266).
  //
  // THE SAFEGUARD: only for slots that were properly marked. Saving a
  // shift writes a row for every employee, so a real shift carries as
  // many weaver rows as the busiest slot of the week. A slot with only a
  // handful was never actually marked, and inferring "idle" from its
  // blanks would dock winders for a shift nobody recorded - the same trap
  // as reading a missing attendance row as absence.
  //
  // "Some rows" was the first version of this test and it was too weak.
  // Migration 266 created 22 Aug night with just TWO rows, which passed,
  // and MALIGA was docked Rs 338.46 for sheds that had run. Half the
  // busiest slot is the line now: 2 of 9 fails, 9 of 9 passes.
  const busiestSlot = Math.max(0, ...rowsPerSlot.values());
  const markedThreshold = busiestSlot / 2;
  if (opts) {
    for (const slotKey of opts.slotKeys) {
      if (slotKey < `${BLANK_SHED_IS_IDLE_FROM}:`) continue;
      const slotRows = rowsPerSlot.get(slotKey) ?? 0;
      // Zero is checked separately: with no rows anywhere the threshold
      // is 0 too, and `0 < 0` is false, so a completely unmarked week
      // would sail through and dock everyone. Caught by the test.
      if (slotRows === 0 || slotRows < markedThreshold) continue;
      for (const shed of opts.sheds) {
        const key = `${shed}:${slotKey}`;
        if (!seen.has(key)) gaps.add(key);
      }
    }
  }
  return gaps;
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
  /** Assigned shed-slots that did NOT run, and so paid nobody — whether
   *  the shed stood idle inside a working shift or the whole shift never
   *  ran. Displayed as "closed"; the name predates the wider meaning. */
  weaverAbsentCount: number;
  /** assignedSheds.length × (workingSlotKeys + idleSlotKeys) — the whole
   *  week, not just the shifts that ran. See SHED_SLOT_DENOMINATOR_FROM. */
  expectedShedSlots: number;
  /** Count of shed-slots this winder covered for an absent winder. */
  coveredForOthers: number;
  /** Shed-slots she was away for but had wound ahead herself, confirmed on
   *  the attendance screen. Recorded for visibility - it carries no extra
   *  money; any reward goes in the Adjustments column by hand. */
  woundAheadCount: number;
}

/**
 * Compute each winder's book salary for the week, moving money from
 * absent winders to the substitutes who covered their sheds.
 */
export function computeWinderAllocation(
  input: WinderAllocationInput,
): Map<number, WinderAllocationResult> {
  const {
    winders, workingSlotKeys, attendance, weaverGapSlots, coverRecords,
    idleSlotKeys, shedStatus,
  } = input;

  // Shifts that belong to the week but never ran. Only from the cutoff:
  // before it, a non-working shift left the week as it always did, so
  // settled weeks recompute to the rupee.
  const idleSlots = (idleSlotKeys ?? []).filter(
    (k) => k >= `${SHED_SLOT_DENOMINATOR_FROM}:`,
  );

  // The week is every shift that counts, run or not. This denominator is
  // the whole point of the change: it must not shrink when the mill stops.
  const nSlots = workingSlotKeys.length + idleSlots.length;

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

  // A night box is earned by the MORNING's winding - a winder works the
  // morning and the shed she winds carries through that day's night. So a
  // night slot needs to know how her morning went.
  const morningStatus = new Map<string, string>();
  for (const a of attendance) {
    const [date, sh] = a.slotKey.split(':');
    if (sh === 'morning' && date) morningStatus.set(`${a.winderId}|${date}`, a.status);
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
      woundAheadCount: 0,
    });
  }

  for (const w of winders) {
    const rate = rateById.get(w.id) ?? 0;
    const res = results.get(w.id);
    if (!res) continue;

    // A shift that belonged to the week but never ran. Nothing was wound
    // on any shed, so every box is lost - there is no cover to reallocate
    // to, and the winder's own attendance does not arise: nobody was
    // called in. Counted rather than looped; the arithmetic is the same
    // for every shed and every idle slot.
    const idleBoxes = idleSlots.length * w.assignedSheds.length;
    if (idleBoxes > 0) {
      res.weaverAbsentCount += idleBoxes;
      res.deduction += rate * idleBoxes;
    }

    for (const slotKey of workingSlotKeys) {
      // A slot with NO attendance row is treated exactly like `absent`.
      //
      // It used to fall through to the credit branch, so a winder who
      // stopped turning up kept earning: nobody creates attendance rows
      // for someone who is no longer there, and "no evidence of absence"
      // was read as "present". PACHAIYAMAAL left after two days in July
      // 2026 and the algorithm would still have paid her Rs 1,650 for
      // that week, 9 of her 12 slots being rows that never existed.
      //
      // The trade-off, accepted 2026-08-23: if a working day is created
      // but attendance is never marked, weekly staff are docked for it
      // until it is filled in. Absence of a record no longer pays.
      const att = attByKey.get(`${w.id}|${slotKey}`);
      // Someone MARKED her absent vs. there is no row at all. The two are
      // treated the same for attendance but NOT for pay - see the absent
      // branch below.
      const marked = att !== undefined;
      const status = att?.status ?? 'absent';

      // Night after a morning she was MARKED absent for: she wound nothing
      // that day, so the night box has nothing to carry. It is handled like
      // an absence - whoever is on the shed that night takes it, and if
      // nobody is, nobody is paid. Note this does NOT fall through to the
      // "she keeps it" branch: that one assumes she had wound ahead, which
      // an absent morning rules out for this day.
      //
      // Only an EXPLICIT 'absent' counts. A morning with no row at all was
      // simply never marked, and docking people for an unrecorded shift is
      // the trap that produced today's other two bugs.
      const [slotDate, slotShift] = slotKey.split(':');
      const nothingToCarry =
        slotShift !== 'morning' &&
        (slotDate ?? '') >= NIGHT_FOLLOWS_MORNING_FROM &&
        morningStatus.get(`${w.id}|${slotDate ?? ''}`) === 'absent';
      for (const shed of w.assignedSheds) {
        // A supervisor's tick on the attendance screen outranks the
        // weaver-row inference (migration 275). Where nobody ticked, the
        // key is missing and we fall back to reading it off the weaver
        // rows exactly as before - so untouched weeks do not move.
        const stated = shedStatus?.get(`${shed}:${slotKey}`);
        const shedIdle = stated !== undefined
          ? !stated
          : weaverGapSlots.has(`${shed}:${slotKey}`);
        if (shedIdle) {
          // Shed did not run -> shed-slot unpaid.
          res.weaverAbsentCount += 1;
          res.deduction += rate;
          continue;
        }
        if (status === 'absent' || nothingToCarry) {
          // Winder absent, weaver present. Who wound this shed?
          //
          // A confirmed record wins. Failing that, fall back to inferring
          // it from who was present holding the shed - the behaviour every
          // week before migration 264, so past figures don't move.
          const record = coverRecords?.get(`${w.id}|${shed}|${slotKey}`);
          const subs = record
            ? (record.outcome === 'covered' && record.coveredBy != null
                ? [{ winderId: record.coveredBy, sheds: new Set([shed]) }]
                : [])
            : (coverBySlot.get(slotKey) ?? []).filter(
                (x) => x.winderId !== w.id && x.sheds.has(shed),
              );

          if (subs.length > 0) {
            // Somebody else did her work, so the money follows the work.
            res.deduction += rate;
            res.reallocatedOut += rate;
            const share = rate / subs.length;
            for (const sub of subs) {
              const subRes = results.get(sub.winderId);
              if (!subRes) continue;
              subRes.book += share;
              subRes.reallocatedIn += share;
              subRes.coveredForOthers += 1;
            }
          } else if (marked && !nothingToCarry) {
            // Nobody else was on the shed, yet the shed RAN - a weaver gap
            // would have been caught above. So the yarn was there: she had
            // wound it ahead, usually on an earlier overtime shift. She
            // keeps the box.
            //
            // Changed 2026-08-24 (PPK): a winder's own absence no longer
            // costs her anything. Before this, the box was simply cancelled
            // and nobody was paid - which docked KAMACHI Rs 333.33 on
            // 23 Aug, when sheds 1 and 3 both ran with ANAND and SURESH A
            // weaving and no winder on the floor at all.
            //
            // Money is now lost in exactly one situation: no weaver on the
            // shed.
            res.book += rate;
            if (record?.outcome === 'wound_ahead') res.woundAheadCount += 1;
          } else {
            // Either no attendance row at all - she is off the roster, she
            // has left - or a night with nothing to carry from an absent
            // morning. Nobody wound this shed, so nobody is paid for it.
            //
            // This is the line that keeps the two rules from colliding.
            // "Absence never costs her" is about an employed winder who
            // took a day off and had wound ahead. Extending it to someone
            // with no rows would pay a departed worker indefinitely, which
            // is the exact bug fixed on 2026-08-23: PACHAIYAMAAL walked out
            // in July and would have kept earning every week since.
            //
            // Marked absent -> she keeps it. No row at all -> nothing.
            res.deduction += rate;
          }
        } else {
          // Present / none / half_day / late / early_leave -> credited.
          res.book += rate;
        }
      }
    }
  }

  return results;
}
