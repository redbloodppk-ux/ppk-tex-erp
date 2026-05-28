'use client';
/**
 * SaveSnapshotForm — small client widget on the Weekly Summary page.
 *
 * Sends the already-computed payload up to /api/wages/weekly/snapshot,
 * which UPSERTs into weekly_wage_summary keyed by (fy_label, week_no).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Save } from 'lucide-react';

interface SaveSnapshotFormProps {
  payload: {
    fy_label: string;
    week_no: number;
    week_start: string;
    week_end: string;
    totals: Record<string, number>;
    per_employee: ReadonlyArray<Record<string, unknown>>;
    wage_entries: ReadonlyArray<Record<string, unknown>>;
    expenses: ReadonlyArray<Record<string, unknown>>;
  };
}

export function SaveSnapshotForm({ payload }: SaveSnapshotFormProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState<boolean>(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSave(): Promise<void> {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await fetch('/app/api/wages/weekly/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setErr(body.error ?? 'Failed to save snapshot.');
      } else {
        setMsg('Snapshot saved.');
        router.refresh();
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Unexpected error.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="btn-secondary"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Save snapshot
      </button>
      {msg && <span className="text-xs text-emerald-700">{msg}</span>}
      {err && <span className="text-xs text-err">{err}</span>}
    </div>
  );
}
