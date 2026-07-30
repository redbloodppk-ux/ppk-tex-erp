'use client';
/**
 * ReminderForm — add a new office/factory reminder (migration 245).
 * Plain insert into the `reminder` table; owner-only per RLS.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2 } from 'lucide-react';
import {
  REMINDER_CATEGORIES, CATEGORY_LABEL, REPEAT_LABEL,
  type ReminderCategory, type ReminderRepeat,
} from '@/lib/reminders/constants';

const REPEATS: ReminderRepeat[] = ['none', 'daily', 'weekly', 'monthly'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReminderForm(): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();

  const [title, setTitle] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<ReminderCategory>('other');
  const [dueDate, setDueDate] = useState<string>(todayISO());
  const [repeat, setRepeat] = useState<ReminderRepeat>('none');

  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!title.trim()) {
      setError('Please enter what this reminder is about.');
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
            {REMINDER_CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
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
          onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}
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
