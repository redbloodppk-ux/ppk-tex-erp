'use client';
/**
 * ReminderForm — add a new office/factory reminder (migrations 245, 246).
 * Plain insert into the `reminder` table; owner-only per RLS.
 *
 * Categories are owner-managed (migration 246) and passed in as a prop
 * fetched server-side by ./page.tsx, rather than imported as a fixed list.
 *
 * 'twice_weekly' repeat requires picking exactly 2 weekdays, and
 * 'twice_monthly' requires picking exactly 2 days of month (1-31, full
 * custom selection) — each picker only appears once its repeat is
 * selected, and submit is blocked until exactly 2 are checked.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import {
  REPEAT_LABEL, WEEKDAY_OPTIONS, MONTHDAY_OPTIONS,
  type ReminderCategory, type ReminderRepeat, type ReminderCategoryRow,
} from '@/lib/reminders/constants';

const REPEATS: ReminderRepeat[] = ['none', 'daily', 'weekly', 'biweekly', 'twice_weekly', 'monthly', 'twice_monthly'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReminderForm({ categories }: { categories: ReminderCategoryRow[] }): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const fallbackCategory = categories[0]?.key ?? 'other';

  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<ReminderCategory>(fallbackCategory);
  const [dueDate, setDueDate] = useState<string>(todayISO());
  const [repeat, setRepeat] = useState<ReminderRepeat>('none');
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [monthdays, setMonthdays] = useState<number[]>([]);

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  function toggleFromPair(value: number, setter: React.Dispatch<React.SetStateAction<number[]>>): void {
    setter((prev) => {
      if (prev.includes(value)) return prev.filter((d) => d !== value);
      if (prev.length >= 2) return prev; // only 2 allowed
      return [...prev, value];
    });
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please enter what this reminder is about.');
      return;
    }
    if (repeat === 'twice_weekly' && weekdays.length !== 2) {
      setError('Pick exactly 2 weekdays for a twice-a-week reminder.');
      return;
    }
    if (repeat === 'twice_monthly' && monthdays.length !== 2) {
      setError('Pick exactly 2 days of the month for a twice-a-month reminder.');
      return;
    }

    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: dbErr } = await (supabase as any).from('reminder').insert([{
      title: title.trim(),
      description: description.trim() || null,
      category,
      due_date: dueDate,
      repeat,
      repeat_weekdays: repeat === 'twice_weekly' ? [...weekdays].sort((a, b) => a - b) : null,
      repeat_monthdays: repeat === 'twice_monthly' ? [...monthdays].sort((a, b) => a - b) : null,
      status: 'active',
      created_by: user?.id ?? null,
      updated_by: user?.id ?? null,
    }]);

    setBusy(false);

    if (dbErr) {
      setError(dbErr.message);
      return;
    }
    router.push('/app/reminders');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="card p-5 space-y-4 max-w-xl">
      <div>
        <label className="label" htmlFor="title">What&apos;s this about?</label>
        <input
          id="title"
          type="text"
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Pay EB bill, Call yarn supplier, Service loom 3"
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label" htmlFor="category">Category</label>
          <select
            id="category"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value as ReminderCategory)}
          >
            {categories.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="dueDate">Due date</label>
          <input
            id="dueDate"
            type="date"
            className="input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="repeat">Repeat</label>
        <select
          id="repeat"
          className="input"
          value={repeat}
          onChange={(e) => {
            setRepeat(e.target.value as ReminderRepeat);
            setWeekdays([]);
            setMonthdays([]);
          }}
        >
          {REPEATS.map((r) => (
            <option key={r} value={r}>{REPEAT_LABEL[r]}</option>
          ))}
        </select>
        <p className="text-[11px] text-ink-mute mt-1">
          Repeating reminders don&apos;t need re-entering — marking one done
          just moves its due date to the next cycle.
        </p>
      </div>

      {repeat === 'twice_weekly' && (
        <div>
          <label className="label">Pick 2 weekdays</label>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_OPTIONS.map((w) => {
              const checked = weekdays.includes(w.value);
              return (
                <button
                  key={w.value}
                  type="button"
                  onClick={() => toggleFromPair(w.value, setWeekdays)}
                  className={
                    'px-2.5 py-1 rounded-md border text-xs font-semibold transition ' +
                    (checked
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-paper text-ink-soft border-line hover:bg-cloud/60')
                  }
                >
                  {w.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-mute mt-1">
            {weekdays.length}/2 selected
          </p>
        </div>
      )}

      {repeat === 'twice_monthly' && (
        <div>
          <label className="label">Pick 2 days of the month</label>
          <div className="flex flex-wrap gap-1.5">
            {MONTHDAY_OPTIONS.map((m) => {
              const checked = monthdays.includes(m.value);
              return (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => toggleFromPair(m.value, setMonthdays)}
                  className={
                    'px-2 py-1 rounded-md border text-xs font-semibold transition ' +
                    (checked
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-paper text-ink-soft border-line hover:bg-cloud/60')
                  }
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-mute mt-1">
            {monthdays.length}/2 selected. A day beyond a shorter month (e.g. 31st in April) falls on that month&apos;s last day instead.
          </p>
        </div>
      )}

      <div>
        <label className="label" htmlFor="description">Notes (optional)</label>
        <textarea
          id="description"
          className="input min-h-[64px]"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Anything you want to recall later — supplier phone number, part needed, etc."
        />
      </div>

      {error && <p className="text-sm text-err">{error}</p>}

      <div className="flex items-center gap-2 pt-2">
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          Save reminder
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => router.push('/app/reminders')}
          disabled={busy}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
