'use client';
/**
 * Delete button for a sizing job.
 *
 * Confirms with the operator, then DELETEs the sizing_job row. The
 * row's child `pavu` records cascade automatically via FK (see the
 * sizing_job → pavu relationship), and the captured bill fields
 * (bill_no, bill_date, charges_amount, total_amount, etc.) disappear
 * with the parent row because they live on the same record. That's
 * the contract the operator asked for: bills can't be deleted on
 * their own — only by removing the parent job.
 *
 * Stock side-effect: the yarn_lot whose current_kg was decremented
 * by yarn_sent_kg is restored to its previous balance so the lot
 * stays consistent.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2 } from 'lucide-react';

interface Props {
  jobId: number;
  /** Used in the confirm prompt + visible label only. */
  jobCode: string;
  /** kg returned to the source yarn_lot. Captured at job creation as
   *  `yarn_sent_kg` on sizing_job. We use it to credit the lot back. */
  yarnSentKg: number;
  /** Lot whose current_kg should be restored. */
  yarnLotId: number | null;
}

export function SizingJobDeleteButton({ jobId, jobCode, yarnSentKg, yarnLotId }: Props): React.ReactElement {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleDelete(): Promise<void> {
    const ok = window.confirm(
      `Delete sizing job ${jobCode}?\n\n` +
      `This also removes the linked bill (if any) and the job's beams.\n` +
      `The source yarn lot will be credited back ${yarnSentKg.toFixed(2)} kg.\n\n` +
      `This cannot be undone.`,
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // Step 1 — restore the source yarn lot's current_kg if we know
    // which lot to credit. Best-effort: if the lot was removed
    // separately, we don't fail the delete on that account.
    if (yarnLotId != null && yarnSentKg > 0) {
      const { data: lot } = await sb
        .from('yarn_lot')
        .select('current_kg')
        .eq('id', yarnLotId)
        .maybeSingle();
      if (lot) {
        await sb
          .from('yarn_lot')
          .update({ current_kg: Number(lot.current_kg ?? 0) + yarnSentKg })
          .eq('id', yarnLotId);
      }
    }

    // Step 2 — delete the job. FK ON DELETE CASCADE on pavu (and any
    // other child tables) takes care of the rest.
    const { error: delErr } = await sb.from('sizing_job').delete().eq('id', jobId);
    if (delErr) {
      setBusy(false);
      setError(delErr.message);
      return;
    }

    startTransition(() => {
      router.push('/app/sizing');
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={busy}
        className="p-1 rounded hover:bg-rose-50 text-rose-700 inline-flex disabled:opacity-50"
        title={`Delete ${jobCode}`}
        aria-label={`Delete ${jobCode}`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
      {error && (
        <span className="text-rose-700 text-[10px] ml-2" title={error}>
          Delete failed
        </span>
      )}
    </>
  );
}
