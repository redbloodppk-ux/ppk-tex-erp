/**
 * Shared constants for the reminders feature (migrations 245, 246).
 *
 * Categories used to be a fixed list; migration 246 moved them into the
 * reminder_category table so the owner can add/rename/delete categories
 * from /app/reminders/categories without a code change. Labels are
 * therefore fetched at request time via the helpers below rather than
 * a static Record. Repeat/status stay as fixed literal unions since
 * they're wired into app logic (nextDueDate, filters, form UI).
 */

export type ReminderCategory = string;
export type ReminderRepeat = 'none' | 'daily' | 'weekly' | 'twice_weekly' | 'monthly';
export type ReminderStatus = 'active' | 'done' | 'archived';

export const REPEAT_LABEL: Record<ReminderRepeat, string> = {
  none:         'One-time',
  daily:        'Repeats daily',
  weekly:       'Repeats weekly',
  twice_weekly: 'Twice a week',
  monthly:      'Repeats monthly',
};

/** ISO weekday numbers (1=Mon .. 7=Sun) -> short label, used by the
 *  twice-weekly weekday picker and for rendering e.g. "Tue & Fri". */
export const WEEKDAY_LABEL: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};
export const WEEKDAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

/** "Tue & Fri" from [2, 5] (order-independent). Returns '' if `days`
 *  isn't a valid twice-weekly pair. */
export function formatWeekdays(days: number[] | null | undefined): string {
  if (!days || days.length !== 2) return '';
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => WEEKDAY_LABEL[d] ?? '?').join(' & ');
}

export interface ReminderCategoryRow {
  key: string;
  label: string;
  is_system: boolean;
  active: boolean;
  sort_order: number;
}

/** Categories available to pick from when creating a reminder — active
 *  ones only, in the owner's chosen order. */
export async function fetchActiveCategories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<ReminderCategoryRow[]> {
  const { data } = await sb
    .from('reminder_category')
    .select('key, label, is_system, active, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  return (data as ReminderCategoryRow[] | null) ?? [];
}

/** Every category, including inactive ones — used by the category
 *  management screen and by label lookups (an existing reminder can
 *  reference a category that's since been deactivated). */
export async function fetchAllCategories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<ReminderCategoryRow[]> {
  const { data } = await sb
    .from('reminder_category')
    .select('key, label, is_system, active, sort_order')
    .order('sort_order', { ascending: true });
  return (data as ReminderCategoryRow[] | null) ?? [];
}

/** key -> label map, for rendering a reminder's category anywhere
 *  (dashboard widget, bell, management page) without a join in every
 *  call site. */
export async function fetchCategoryLabelMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any,
): Promise<Record<string, string>> {
  const rows = await fetchAllCategories(sb);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.label;
  return map;
}
