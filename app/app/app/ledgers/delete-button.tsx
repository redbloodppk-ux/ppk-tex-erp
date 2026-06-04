'use client';
/**
 * Per-row delete button for the Ledger list. Pops a confirm dialog
 * before calling deleteLedger(). The server action tries a hard DELETE
 * first; if the ledger is referenced elsewhere (customer / party /
 * payment / invoice) the FK constraint forces a soft delete (active
 * flag = false) and we surface that as a brief notice.
 */
import { useState, useTransition } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { deleteLedger } from './actions';

export function LedgerDeleteButton({ id, name }: { id: number; name: string }): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [softNote, setSoftNote] = useState<string | null>(null);

  function handleClick(): void {
    if (!window.confirm(`Delete ledger "${name}"?\n\nIf it's used by any customer, party, payment, or invoice, it will be marked inactive instead of removed (history stays intact).`)) return;
    setSoftNote(null);
    startTransition(async () => {
      const res = await deleteLedger(id);
      if (!res.ok) {
        window.alert(`Delete failed: ${res.error ?? 'Unknown error'}`);
        return;
      }
      if (res.soft_deleted) {
        setSoftNote('Marked inactive (in use by other records).');
        // Brief delay so the user sees the note before the list reloads.
        setTimeout(() => setSoftNote(null), 4000);
      }
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="p-1 rounded hover:bg-red-50 text-red-600"
        title="Delete this ledger"
      >
        {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
      {softNote && (
        <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5">
          {softNote}
        </span>
      )}
    </span>
  );
}
