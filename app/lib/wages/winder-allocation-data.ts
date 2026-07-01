/**
 * Supabase-backed loader for winder wage allocation.
 *
 * Gathers the per-slot attendance inputs the pure `computeWinderAllocation`
 * helper needs and runs it. Both the Weekly Wage page and the shared
 * `buildWeeklyWageData` builder call this, so the reallocation-of-money
 * rule (absent winder -> substitute) can never drift between the screen
 * and the Excel / PDF exports.
 */
import {
  computeWinderAllocation,
  type WinderAllocationResult,
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

  // 1) Working shift-slots in the week (holiday shifts excluded).
  const { data: daysRaw } = await supabase
    .from('attendance_day')
    .select('id, attendance_date, shift, is_working')
    .gte('attendance_date', weekStart)
    .lte('attendance_date', weekEnd)
    .eq('is_working', true);
  const workingSlotKeys: string[] = [];
  const workingDayIds: number[] = [];
  const slotByDayId = new Map<number, string>();
  for (const d of (daysRaw ?? []) as Array<{
    id: number;
    attendance_date: string | null;
    shift: string | null;
    is_working: boolean | null;
  }>) {
    if (d.is_working !== true) continue;
    workingDayIds.push(d.id);
    if (d.attendance_date && d.shift) {
      const key = `${d.attendance_date}:${d.shift}`;
      workingSlotKeys.push(key);
      slotByDayId.set(d.id, key);
    }
  }

  // 2) Each winder's attendance per slot, with the sheds actually covered.
  const { data: winAttRaw } = await supabase
    .from('attendance_entry')
    .select(
      'employee_id, status, shed_no, shed_nos, attendance_day:attendance_day_id ( attendance_date, shift, is_working )',
    )
    .in('employee_id', winderIds)
    .gte('attendance_day.attendance_date', weekStart)
    .lte('attendance_day.attendance_date', weekEnd);
  const attendance = [];
  for (const r of (winAttRaw ?? []) as Array<{
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

  // 3) Weaver gap shed-slots: weaver absent/none in a working slot, keyed
  //    "shed:date:shift". These shed-slots pay nobody.
  const weaverGapSlots = new Set<string>();
  if (workingDayIds.length > 0) {
    const { data: gapRaw } = await supabase
      .from('attendance_entry')
      .select('status, shed_no, attendance_day_id, employee:employee_id ( role )')
      .in('status', ['absent', 'none'])
      .in('attendance_day_id', workingDayIds);
    for (const r of (gapRaw ?? []) as Array<{
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
      weaverGapSlots.add(`${shed}:${slotKey}`);
    }
  }

  return computeWinderAllocation({
    winders: winders.map((w) => ({
      id: w.id,
      weeklySalary: w.weeklySalary,
      assignedSheds: w.assignedSheds,
    })),
    workingSlotKeys,
    attendance,
    weaverGapSlots,
  });
}
