'use client';
// Delete button for a fabric_quality row. Hard-deletes after confirm; on
// FK violation (fabric in use by sales orders / production / costing
// reference) the message tells the operator to untick Active instead.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Loader2, Trash2 } from 'lucide-react';

interface FabricDeleteButtonProps {
  id: number;
  label: string;
}

export function FabricDeleteButton({ id, label }: FabricDeleteButtonProps): React.ReactElement {
  const supabase = createClient();
  const router = useRouter();
  const [busy, setBusy] = useState<boolean>(false);
  const [err, setErr] = useState<string | null>(null);

  async function onClick(): Promise<void> {
    if (busy) return;
    const ok = window.confirm(
      `Delete fabric "${label}"?\n\nThis cannot be undone. If the fabric is in use by sales orders, invoices, or production, the delete will fail — untick Active to archive it instead.`,
    );
    if (!ok) return;
    setErr(null);
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const { error } = await sb.from('fabric_quality').delete().eq('id', id);
    setBusy(false);
    if (error) {
      const pgCode = (error as { code?: string }).code;
      if (pgCode === '23503') {
        setErr('In use by other records.');
        window.alert(
          `Cannot delete fabric "${label}".\n\nIt is referenced by sales orders, invoices, production or other records. Untick Active to archive it instead.`,
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
      title={err ?? 'Delete this fabric'}
      className="inline-flex items-center gap-1 text-xs text-rose-700 hover:text-rose-900 font-semibold disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      Delete
    </button>
  );
}
