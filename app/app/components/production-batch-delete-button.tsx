'use client';
// Delete button for a production_batch row. Wipes the matching
// stock_ledger rows (source_kind='production_batch', source_id=batchId)
// first, then hard-deletes the production_batch row. If the batch is
// referenced elsewhere (e.g. fabric_receipt link) the delete will fail
// with FK 23503 and the operator is told to remove the linked record
// first.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2 } from 'lucide-react';

interface ProductionBatchDeleteButtonProps {
  id: number;
  code: string | null;
}

export function ProductionBatchDeleteButton({
  id,
  code,
}: ProductionBatchDeleteButtonProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    if (busy) return;
    const label = code ?? `#${id}`;
    const ok = window.confirm(
      `Delete production batch ${label}?\n\nThis hard-deletes the batch AND removes all stock-ledger movements it posted (raw material outflows + produced fabric inflow). This cannot be undone.`,
    );
    if (!ok) return;

    setErr(null);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    // 1. Wipe stock_ledger rows tied to this batch.
    const { error: ledErr } = await sb
      .from('stock_ledger')
      .delete()
      .eq('source_kind', 'production_batch')
      .eq('source_id', id);
    if (ledErr) {
      setBusy(false);
      setErr(ledErr.message);
      window.alert(`Failed to clear stock ledger: ${ledErr.message}`);
      return;
    }

    // 2. Hard-delete the batch row.
    const { error: delErr } = await sb.from('production_batch').delete().eq('id', id);
    setBusy(false);
    if (delErr) {
      const pgCode = (delErr as { code?: string }).code;
      if (pgCode === '23503') {
        setErr('In use by other records.');
        window.alert(
          `Cannot delete batch ${label}.\n\nIt is referenced by other records (e.g. a linked fabric receipt). Remove those first, then try again.`,
        );
      } else {
        setErr(delErr.message);
        window.alert(`Failed to delete: ${delErr.message}`);
      }
      return;
    }
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title={err ?? 'Delete this batch'}
      className="p-1 rounded hover:bg-rose-50 text-rose-700 inline-flex disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
    </button>
  );
}
