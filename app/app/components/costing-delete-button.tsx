'use client';
// Delete button for a costing_master row. Hard-deletes the row after the
// operator confirms. If the row is referenced by sales orders / invoices /
// production etc. (Postgres error 23503), the message tells the operator
// to use the Active toggle to archive instead, since a hard delete would
// break those records.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2 } from 'lucide-react';

interface CostingDeleteButtonProps {
  id: number;
  code: string | null;
}

export function CostingDeleteButton({ id, code }: CostingDeleteButtonProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    if (busy) return;
    const label = code ?? `#${id}`;
    const ok = window.confirm(
      `Delete costing ${label}?\n\nThis cannot be undone. If the costing is in use by sales orders, invoices, or production, the delete will fail — untick Active to archive it instead.`,
    );
    if (!ok) return;

    setErr(null);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('costing_master').delete().eq('id', id);
    setBusy(false);
    if (error) {
      const pgCode = (error as { code?: string }).code;
      if (pgCode === '23503') {
        setErr('In use by other records — untick Active to archive instead.');
        window.alert(
          `Cannot delete costing ${label}.\n\nIt is referenced by sales orders, invoices, production batches, fabric stock or similar records. Untick Active on the row to archive it.`,
        );
      } else {
        setErr(error.message);
        window.alert(`Failed to delete: ${error.message}`);
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
      title={err ?? 'Delete this costing'}
      className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-900 font-semibold disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      Delete
    </button>
  );
}
