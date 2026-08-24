/**
 * Winder weekly wage allocation with substitute reallocation.
 *
 * Business rule (July 2026): a winder is paid per shed she is assigned,
 * per working shift-slot in the week. Her per-slot rate is
 *   weekly_salary / (assigned sheds * working shift-slots in the week).
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
 *     does NOT keep it.
 *   - No attendance row at all -> nothing. She is not on the roster; she
 *     has left. Do not confuse this with being marked absent.
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
 * A shed-slot with no weaver row at all is not a gap: that shed simply is
 * not part of the week's roster.
 */
export function deriveWeaverGapSlots(rows: WeaverShedRow[]): Set<string> {
  const seen = new Set<string>();
  const worked = new Set<string>();
  for (const r of rows) {
    if (!r.shed || !r.slotKey) continue;
    const key = `${r.shed}:${r.slotKey}`;
    seen.add(key);
    if (WEAVER_WORKED.has(r.status)) worked.add(key);
  }
  const gaps = new Set<string>();
  for (const key of seen) if (!worked.has(key)) gaps.add(key);
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
  /** Assigned shed-slots left unpaid because the weaver was absent. */
  weaverAbsentCount: number;
  /** assignedSheds.length × workingSlotKeys.length. */
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
  const { winders, workingSlotKeys, attendance, weaverGapSlots, coverRecords } = input;
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
        morningStatus.get(`${w.id}|${slotDate ?? ''}`) === 'absent';
      for (const shed of w.assignedSheds) {
        if (weaverGapSlots.has(`${shed}:${slotKey}`)) {
          // Weaver absent -> shed-slot unpaid.
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
