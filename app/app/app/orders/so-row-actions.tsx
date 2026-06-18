'use client';
/**
 * Per-row Edit / Delete actions for the Sales Orders list.
 *
 * Both actions are only offered for orders that are still in an early stage
 * (draft / pending approval / confirmed). Once an order is in production,
 * dispatched, invoiced or paid, editing or deleting it would corrupt the
 * downstream delivery and billing records, so the actions are hidden.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Loader2 } from 'lucide-react';

const MODIFIABLE_STATUSES = new Set(['draft', 'pending_approval', 'approved']);

interface SoRowActionsProps {
  soId: number;
  soNumber: string;
  status: string;
}

export function SoRowActions({ soId, soNumber, status }: SoRowActionsProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canModify = MODIFIABLE_STATUSES.has(status);

  async function handleDelete(): Promise<void> {
    if (!window.confirm(`Delete order ${soNumber}? This permanently removes the order and its lines.`)) {
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any;
    const { error } = await sb.from('sales_order').delete().eq('id', soId);
    setBusy(false);
    if (error) {
      window.alert(`Could not delete ${soNumber}: ${error.message}`);
      return;
    }
    router.refresh();
  }

  if (!canModify) {
    return <span className="text-[11px] text-ink-mute">—</span>;
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/app/orders/${soId}/edit`}
        className="p-1.5 rounded hover:bg-indigo-50 text-indigo-600"
        title={`Edit ${soNumber}`}
      >
        <Pencil className="w-4 h-4" />
      </Link>
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={busy}
        className="p-1.5 rounded hover:bg-rose-50 text-rose-600 disabled:opacity-40"
        title={`Delete ${soNumber}`}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
      </button>
    </div>
  );
}
