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
import { AlarmClock, AlertTriangle, ArrowRight, Repeat } from 'lucide-react';
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

  const [{ data, error }, categoryLabels] = await Promise.all([
    sb
      .from('reminder')
      .select('id, title, category, due_date, repeat, repeat_weekdays, repeat_monthdays')
      .eq('status', 'active')
      .lte('due_date', windowEnd)
      .order('due_date', { ascending: true })
      .limit(MAX_ROWS),
    fetchCategoryLabelMap(sb),
  ]);

  const rows = (data as ReminderRow[] | null) ?? [];
  const overdueCount = rows.filter((r) => r.due_date < todayIso).length;

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
            <ReminderRowItem key={r.id} r={r} todayIso={todayIso} categoryLabel={categoryLabels[r.category] ?? r.category} />
          ))}
        </div>
      )}
    </section>
  );
}

function ReminderRowItem({ r, todayIso, categoryLabel }: { r: ReminderRow; todayIso: string; categoryLabel: string }): React.ReactElement {
  const overdue = r.due_date < todayIso;
  const dueToday = r.due_date === todayIso;
  const tone = overdue
    ? 'border-rose-200 bg-rose-50/60'
    : dueToday
      ? 'border-amber-200 bg-amber-50/60'
      : 'border-line/60 bg-cloud/10';

  const repeatLabel = formatRepeatLabel(r.repeat, r.repeat_weekdays, r.repeat_monthdays);

  return (
    <div className={`flex items-start justify-between gap-2 rounded-lg border p-2.5 ${tone}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {(overdue || dueToday) && (
            <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${overdue ? 'text-rose-500' : 'text-amber-500'}`} />
          )}
          <span className="text-sm font-medium text-ink truncate">{r.title}</span>
        </div>
        <div className="text-xs text-ink-mute mt-0.5">
          {categoryLabel}
          <span> · </span>
          <span className={overdue ? 'text-rose-700 font-semibold' : dueToday ? 'text-amber-700 font-semibold' : ''}>
            {overdue ? `Overdue since ${formatDate(r.due_date)}` : dueToday ? 'Due today' : formatDate(r.due_date)}
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
