/**
 * Supabase-backed loader for winder wage allocation.
 *
 * Gathers the per-slot attendance inputs the pure `computeWinderAllocation`
 * helper needs and runs it. Both the Weekly Wage page and the shared
 * `buildWeeklyWageData` builder call this, so the reallocation-of-money
 * rule (absent winder -> substitute) can never drift between the screen
 * and the Excel / PDF exports.
 */
import { fetchAll } from '@/lib/supabase/fetch-all';
import {
  computeWinderAllocation,
  deriveWeaverGapSlots,
  type WeaverShedRow,
  type WinderAllocationResult,
  type WinderCoverRecord,
} from './winder-allocation';

/** A winder to allocate for. `assignedSheds` = employee.default_sheds. */
export interface WinderInfo {
  id: number;
  weeklySalary: number;
  assignedSheds: string[];
}

interface AttendanceDayJoin {
  attendance_date: string | null;
  shift: string | null;
  is_working: boolean | null;
}

/**
 * Load attendance for the week and compute each winder's allocation.
 * @param supabase  A Supabase client (typed as any to match caller sites).
 * @param weekStart YYYY-MM-DD Monday.
 * @param weekEnd   YYYY-MM-DD Sunday.
 * @param winders   Winders with their assigned sheds and weekly salary.
 */
export async function loadWinderAllocation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  weekStart: string,
  weekEnd: string,
  winders: WinderInfo[],
): Promise<Map<number, WinderAllocationResult>> {
  if (winders.length === 0) return new Map();
  const winderIds = winders.map((w) => w.id);

  // 1) Every shift-slot in the week, split into those that ran and those
  //    that did not.
  //
  //    Both halves count towards the denominator: a night the mill could
  //    not run for want of weavers is still one of the week's 13 shifts,
  //    it simply pays nobody. Only counts_in_week = false leaves the week
  //    altogether, which in practice means Sunday night. See migration 275
  //    and SHED_SLOT_DENOMINATOR_FROM.
  //
  //    Note this no longer filters on is_working in the query — doing so
  //    is what made a closed mill shrink the week and RAISE the box rate.
  const { data: daysRaw } = await supabase
    .from('attendance_day')
    .select('id, attendance_date, shift, is_working, counts_in_week')
    .gte('attendance_date', weekStart)
    .lte('attendance_date', weekEnd);
  const workingSlotKeys: string[] = [];
  const idleSlotKeys: string[] = [];
  const workingDayIds: number[] = [];
  const slotByDayId = new Map<number, string>();
  for (const d of (daysRaw ?? []) as Array<{
    id: number;
    attendance_date: string | null;
    shift: string | null;
    is_working: boolean | null;
    counts_in_week: boolean | null;
  }>) {
    // Older rows predate the column; treat a missing value as "in the
    // week", which is the default the migration set.
    if (d.counts_in_week === false) continue;
    if (!d.attendance_date || !d.shift) continue;
    const key = `${d.attendance_date}:${d.shift}`;
    if (d.is_working === true) {
      workingDayIds.push(d.id);
      workingSlotKeys.push(key);
      slotByDayId.set(d.id, key);
    } else {
      idleSlotKeys.push(key);
    }
  }

  // 2) Each winder's attendance per slot, with the sheds actually covered.
  const winAtt = await fetchAll<{
    employee_id: number; status: string;
    shed_no: string | null; shed_nos: string[] | null;
    attendance_day: AttendanceDayJoin | null;
  }>((lo, hi) => supabase
    .from('attendance_entry')
    .select(
      // !inner makes the date filter a real join filter — without it
      // PostgREST returns these employees' ENTIRE history (day nulled for
      // out-of-range rows) and silently truncates at the 1000-row cap.
      'id, employee_id, status, shed_no, shed_nos, attendance_day:attendance_day_id!inner ( attendance_date, shift, is_working )',
    )
    .in('employee_id', winderIds)
    .gte('attendance_day.attendance_date', weekStart)
    .lte('attendance_day.attendance_date', weekEnd)
    .order('id', { ascending: true })
    .range(lo, hi));
  const attendance = [];
  for (const r of winAtt.rows as Array<{
    employee_id: number;
    status: string;
    shed_no: string | null;
    shed_nos: string[] | null;
    attendance_day: AttendanceDayJoin | null;
  }>) {
    const day = r.attendance_day;
    if (!day?.attendance_date || !day?.shift || day.is_working !== true) continue;
    const slotKey = `${day.attendance_date}:${day.shift}`;
    const arr = Array.isArray(r.shed_nos)
      ? r.shed_nos.filter((s) => typeof s === 'string' && s.length > 0)
      : [];
    const sheds = arr.length > 0 ? arr : r.shed_no ? [r.shed_no] : [];
    attendance.push({
      winderId: r.employee_id,
      slotKey,
      status: r.status,
      sheds,
    });
  }

  // 3) Weaver gap shed-slots, keyed "shed:date:shift".
  //
  //    Fetches EVERY weaver row for the week, not just the absent ones.
  //    A shed-slot is only a gap when none of its rows shows a weaver who
  //    worked — see `deriveWeaverGapSlots` for why filtering to
  //    absent/none here silently docked a winder for sheds that ran.
  //    ~144 entries a week, well inside PostgREST's 1000-row cap.
  let weaverGapSlots = new Set<string>();
  if (workingDayIds.length > 0) {
    const gapAll = await fetchAll<{
      status: string;
      shed_no: string | null;
      attendance_day_id: number;
      employee: { role: string | null } | null;
    }>((lo, hi) => supabase
      .from('attendance_entry')
      .select('id, status, shed_no, attendance_day_id, employee:employee_id ( role )')
      .in('attendance_day_id', workingDayIds)
      .order('id', { ascending: true })
      .range(lo, hi));
    const weaverRows: WeaverShedRow[] = [];
    for (const r of gapAll.rows as Array<{
      status: string;
      shed_no: string | null;
      attendance_day_id: number;
      employee: { role: string | null } | null;
    }>) {
      const role = (r.employee?.role ?? '').toLowerCase();
      if (role !== 'weaver') continue;
      const shed = r.shed_no;
      if (!shed) continue;
      const slotKey = slotByDayId.get(r.attendance_day_id);
      if (!slotKey) continue;
      weaverRows.push({ shed, slotKey, status: r.status });
    }
    // Sheds worth reasoning about = every shed some winder is paid for.
    const shedsInPlay = Array.from(
      new Set(winders.flatMap((w) => w.assignedSheds).filter((s) => s.length > 0)),
    );
    weaverGapSlots = deriveWeaverGapSlots(weaverRows, {
      sheds: shedsInPlay,
      slotKeys: workingSlotKeys,
    });
  }

  // 4) Supervisor-confirmed cover (migration 264). A row exists only when
  //    someone actively answered on the attendance screen, so any shed-slot
  //    missing from this map falls back to the old inference and computes
  //    exactly as it did before the table existed.
  const coverRecords = new Map<string, WinderCoverRecord>();
  if (workingDayIds.length > 0) {
    const { data: coverRaw } = await supabase
      .from('winder_cover')
      .select('attendance_day_id, absent_employee_id, shed_no, outcome, covered_by_employee_id')
      .in('attendance_day_id', workingDayIds);
    for (const r of (coverRaw ?? []) as Array<{
      attendance_day_id: number;
      absent_employee_id: number;
      shed_no: string;
      outcome: string;
      covered_by_employee_id: number | null;
    }>) {
      const slotKey = slotByDayId.get(r.attendance_day_id);
      if (!slotKey || !r.shed_no) continue;
      if (r.outcome !== 'covered' && r.outcome !== 'wound_ahead') continue;
      coverRecords.set(`${r.absent_employee_id}|${r.shed_no}|${slotKey}`, {
        outcome: r.outcome,
        coveredBy: r.covered_by_employee_id,
      });
    }
  }

  // 5) Supervisor-stated shed running status (migration 275). Same shape
  //    of contract as winder_cover above: a row exists only where somebody
  //    ticked, and a missing row leaves the weaver-row inference in charge.
  const shedStatus = new Map<string, boolean>();
  if (workingDayIds.length > 0) {
    const { data: shedRaw } = await supabase
      .from('shed_shift_status')
      .select('attendance_day_id, shed_no, is_running')
      .in('attendance_day_id', workingDayIds);
    for (const r of (shedRaw ?? []) as Array<{
      attendance_day_id: number;
      shed_no: string;
      is_running: boolean;
    }>) {
      const slotKey = slotByDayId.get(r.attendance_day_id);
      if (!slotKey || !r.shed_no) continue;
      shedStatus.set(`${r.shed_no}:${slotKey}`, r.is_running === true);
    }
  }

  return computeWinderAllocation({
    winders: winders.map((w) => ({
      id: w.id,
      weeklySalary: w.weeklySalary,
      assignedSheds: w.assignedSheds,
    })),
    workingSlotKeys,
    idleSlotKeys,
    attendance,
    weaverGapSlots,
    coverRecords,
    shedStatus,
  });
}
