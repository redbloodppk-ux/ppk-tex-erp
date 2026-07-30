'use client';
/**
 * "Mark done" for a single reminder. One-time reminders disappear from the
 * active list; repeating reminders quietly roll their due_date forward and
 * stay active (see app/app/reminders/actions.ts). Shared between the
 * /app/reminders management page and the dashboard widget.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Check } from 'lucide-react';
import { markReminderDone } from '@/app/app/reminders/actions';

export function MarkDoneButton({ id, repeats }: { id: number; repeats: boolean }): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function handleClick(): void {
    setErr(null);
    startTransition(async () => {
      const res = await markReminderDone(id);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-white px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        title={repeats ? 'Mark done — the next cycle stays on the list' : 'Mark done'}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Mark done
      </button>
      {err && <span className="text-[10px] text-rose-600">{err}</span>}
    </div>
  );
}
