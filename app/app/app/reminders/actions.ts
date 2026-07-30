'use server';
/**
 * Server actions for the reminders register (migrations 245, 246, 247).
 *
 * "Mark done" behaves differently depending on whether the reminder
 * repeats: a one-time reminder just flips to status='done'. A repeating
 * reminder (daily/weekly/twice_weekly/monthly/twice_monthly) instead
 * rolls due_date forward to the next cycle and stays 'active' — so
 * "Pay EB bill" (monthly) never needs re-entering, it just reappears
 * next month.
 *
 * Delete is a soft delete (status='archived') so a mis-added reminder can
 * be hidden without losing the audit trail, matching the rest of the app's
 * "archived" convention (see record_status enum).
 */
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';

type ActionResult = { ok: true } | { ok: false; error: string };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** ISO weekday: 1=Mon .. 7=Sun (JS's getUTCDay() is 0=Sun .. 6=Sat). */
function isoWeekday(d: Date): number {
  const wd = d.getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Number of days in the UTC month `d` falls in. */
function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

/** Does `d`'s day-of-month match `target`? A target beyond the month's
 *  length (e.g. 31 in April) clamps to that month's last day, so a
 *  reminder scheduled for the 31st still fires on April 30. */
function matchesMonthday(d: Date, target: number): boolean {
  return d.getUTCDate() === Math.min(target, daysInMonth(d));
}

/** Advance due_date by one repeat cycle, then keep advancing (guarded)
 *  until the result is in the future — so a reminder that's been overdue
 *  for several cycles doesn't pop right back up as overdue the instant
 *  it's marked done. For 'twice_weekly', `weekdays` holds the two ISO
 *  weekday numbers (1=Mon..7=Sun) the reminder is scheduled on. For
 *  'twice_monthly', `monthdays` holds the two day-of-month numbers
 *  (1-31) the reminder is scheduled on. */
function nextDueDate(
  dueDate: string,
  repeat: string,
  weekdays: number[] | null,
  monthdays: number[] | null,
): string {
  const todayIso = new Date().toISOString().slice(0, 10);
  let d = new Date(`${dueDate}T00:00:00Z`);

  function step(): void {
    if (repeat === 'daily') {
      d = new Date(d.getTime() + ONE_DAY_MS);
    } else if (repeat === 'weekly') {
      d = new Date(d.getTime() + 7 * ONE_DAY_MS);
    } else if (repeat === 'monthly') {
      const next = new Date(d);
      next.setUTCMonth(next.getUTCMonth() + 1);
      d = next;
    } else if (repeat === 'twice_weekly' && weekdays && weekdays.length === 2) {
      // Step forward one day at a time until landing on one of the two
      // scheduled weekdays — always moves at least one day, so a
      // reminder due on its own weekday still jumps to the *other*
      // scheduled weekday next, not the same day again.
      do {
        d = new Date(d.getTime() + ONE_DAY_MS);
      } while (!weekdays.includes(isoWeekday(d)));
    } else if (repeat === 'twice_monthly' && monthdays && monthdays.length === 2) {
      // Same catch-up pattern as twice_weekly, but matching day-of-month
      // instead of weekday (with month-length clamping — see matchesMonthday).
      const [firstMonthday, secondMonthday] = monthdays as [number, number];
      do {
        d = new Date(d.getTime() + ONE_DAY_MS);
      } while (!matchesMonthday(d, firstMonthday) && !matchesMonthday(d, secondMonthday));
    }
  }

  step();
  let iso = d.toISOString().slice(0, 10);
  let guard = 0;
  while (iso <= todayIso && guard < 1000) {
    step();
    iso = d.toISOString().slice(0, 10);
    guard += 1;
  }
  return iso;
}

export async function markReminderDone(id: number): Promise<ActionResult> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: row, error: fetchErr } = await sb
    .from('reminder')
    .select('due_date, repeat, repeat_weekdays, repeat_monthdays')
    .eq('id', id)
    .maybeSingle();
  if (fetchErr) return { ok: false, error: fetchErr.message };
  if (!row) return { ok: false, error: 'Reminder not found.' };

  const { data: auth } = await supabase.auth.getUser();
  const updated_by = auth?.user?.id ?? null;

  const payload = row.repeat === 'none'
    ? { status: 'done', updated_by }
    : {
        due_date: nextDueDate(
          row.due_date as string,
          row.repeat as string,
          (row.repeat_weekdays as number[] | null) ?? null,
          (row.repeat_monthdays as number[] | null) ?? null,
        ),
        updated_by,
      };

  const { error } = await sb.from('reminder').update(payload).eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/reminders');
  revalidatePath('/app/dashboard');
  return { ok: true };
}

export async function archiveReminder(id: number): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('reminder')
    .update({ status: 'archived', updated_by: auth?.user?.id ?? null })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/app/reminders');
  revalidatePath('/app/dashboard');
  return { ok: true };
}
