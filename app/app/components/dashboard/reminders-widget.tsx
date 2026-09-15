/**
 * Reminders widget (migration 245) — dashboard highlight for upcoming AND
 * due reminders. Wider window than the notification bell (which only
 * shows due/overdue): here we also surface anything due in the next 7
 * days, so the owner sees it coming before it's overdue.
 *
 * Server component, same shape as TodayAttendanceWidget — the "Mark done"
 * / "Delete" buttons are client components that call the shared server
 * actions in app/app/reminders/actions.ts and router.refresh() this page.
 */
import Link from 'next/link';
import { AlarmClock, AlertTriangle, ArrowRight, Repeat, CheckCircle2, Clock } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils';
import {
  formatRepeatLabel, fetchCategoryLabelMap,
  type ReminderCategory, type ReminderRepeat,
} from '@/lib/reminders/constants';
import { MarkDoneButton } from '@/app/components/reminders/mark-done-button';
import { DeleteReminderButton } from '@/app/components/reminders/delete-reminder-button';

const UPCOMING_WINDOW_DAYS = 7;
const MAX_ROWS = 8;

interface ReminderRow {
  id: number;
  title: string;
  category: ReminderCategory;
  due_date: string;
  repeat: ReminderRepeat;
  repeat_weekdays: number[] | null;
  repeat_monthdays: number[] | null;
}

export async function RemindersWidget(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const windowEnd = new Date(Date.now() + UPCOMING_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const [{ data, error }, categoryLabels, { data: doneData }] = await Promise.all([
    sb
      .from('reminder')
      .select('id, title, category, due_date, repeat, repeat_weekdays, repeat_monthdays')
      .eq('status', 'active')
      .lte('due_date', windowEnd)
      .order('due_date', { ascending: true })
      .limit(MAX_ROWS),
    fetchCategoryLabelMap(sb),
    // When each reminder was last actually ticked (migration 301). Without
    // it a repeating job can only say when it is next due, which does not
    // answer "have we done it?" — PPK, 2026-09-15.
    sb.from('v_reminder_last_done').select('reminder_id, last_done_on, times_done'),
  ]);

  const rows = (data as ReminderRow[] | null) ?? [];
  const lastDone = new Map<number, string>();
  for (const d of (doneData ?? []) as Array<{ reminder_id: number; last_done_on: string | null }>) {
    if (d.last_done_on) lastDone.set(d.reminder_id, d.last_done_on);
  }
  const overdueCount = rows.filter((r) => r.due_date < todayIso).length;
  const toDoNowCount = rows.filter((r) => r.due_date <= todayIso).length;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <AlarmClock className="w-4 h-4 text-indigo" />
          <h2 className="font-display font-bold text-base">Reminders</h2>
          {overdueCount > 0 && (
            <span className="pill bg-rose-50 text-rose-700 border border-rose-100">
              {overdueCount} overdue
            </span>
          )}
          {/* Nothing waiting is worth saying out loud — it is the answer to
              the question the widget is there to ask. */}
          {rows.length > 0 && toDoNowCount === 0 && (
            <span className="pill bg-emerald-50 text-emerald-700 border border-emerald-100">
              All done
            </span>
          )}
        </div>
        <Link
          href="/app/reminders"
          className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline"
        >
          View all <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {error && (
        <div className="text-sm text-err mb-3">
          Could not load reminders: {error.message}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-ink-soft py-2">
          Nothing due in the next {UPCOMING_WINDOW_DAYS} days.{' '}
          <Link href="/app/reminders/new" className="text-indigo font-semibold">
            Add a reminder
          </Link>
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <ReminderRowItem
              key={r.id}
              r={r}
              todayIso={todayIso}
              categoryLabel={categoryLabels[r.category] ?? r.category}
              lastDoneOn={lastDone.get(r.id) ?? null}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * One reminder, in one of three states you can read without stopping to
 * think. PPK, 2026-09-15: "show finished and unfinished by highlight or
 * image ... easy to identify that when i look at that reminder".
 *
 *   OVERDUE   red band,   ! icon,  "Overdue since 27 Jul"
 *   TO DO     amber band, ! icon,  "Do today"
 *   DONE      green band, tick,    "Done" + when, and when it comes round again
 *
 * The rule behind the tick is deliberately simple: a reminder whose next due
 * date is in the future has nothing outstanding, so it is done. That is only
 * meaningful because the tick is now recorded (migration 301) — the date
 * beside it is the real one PPK last pressed the button on, not a guess from
 * the due date.
 *
 * A reminder that has never been ticked gets the neutral state rather than a
 * green one: "not due yet" is not the same claim as "done", and the history
 * only starts at the first tick.
 */
function ReminderRowItem({
  r, todayIso, categoryLabel, lastDoneOn,
}: {
  r: ReminderRow; todayIso: string; categoryLabel: string; lastDoneOn: string | null;
}): React.ReactElement {
  const overdue = r.due_date < todayIso;
  const dueToday = r.due_date === todayIso;
  const outstanding = overdue || dueToday;
  const done = !outstanding && lastDoneOn != null;

  const tone = overdue
    ? 'border-rose-200 bg-rose-50/60'
    : dueToday
      ? 'border-amber-200 bg-amber-50/60'
      : done
        ? 'border-emerald-200 bg-emerald-50/50'
        : 'border-line/60 bg-cloud/10';

  const repeatLabel = formatRepeatLabel(r.repeat, r.repeat_weekdays, r.repeat_monthdays);

  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border p-2.5 ${tone}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* The badge carries the state in a word as well as a colour —
              colour alone is no good to anyone who cannot separate red from
              green, and no good at all in a printout. */}
          {overdue ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-rose-600 text-white shrink-0">
              <AlertTriangle className="w-3 h-3" /> Overdue
            </span>
          ) : dueToday ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500 text-white shrink-0">
              <AlertTriangle className="w-3 h-3" /> To do
            </span>
          ) : done ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
              <CheckCircle2 className="w-3 h-3" /> Done
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-cloud text-ink-soft shrink-0">
              <Clock className="w-3 h-3" /> Upcoming
            </span>
          )}
          <span className="text-sm font-medium text-ink truncate">{r.title}</span>
        </div>
        <div className="text-xs text-ink-mute mt-0.5">
          {categoryLabel}
          <span> · </span>
          <span className={overdue ? 'text-rose-700 font-semibold' : dueToday ? 'text-amber-700 font-semibold' : done ? 'text-emerald-700 font-semibold' : ''}>
            {overdue
              ? `Overdue since ${formatDate(r.due_date)}`
              : dueToday
                ? 'Do today'
                : done
                  ? `Done ${formatDate(lastDoneOn)} · again ${formatDate(r.due_date)}`
                  : `Due ${formatDate(r.due_date)}`}
          </span>
          {r.repeat !== 'none' && (
            <>
              <span> · </span>
              <span className="inline-flex items-center gap-1"><Repeat className="w-3 h-3" /> {repeatLabel}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <MarkDoneButton id={r.id} repeats={r.repeat !== 'none'} />
        <DeleteReminderButton id={r.id} label={r.title} />
      </div>
    </div>
  );
}
