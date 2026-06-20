'use client';
/**
 * Per-row actions for the Sales Orders list.
 *
 * Early-stage orders (draft / pending approval / confirmed) can be Edited
 * or Deleted — once an order is in production, dispatched, invoiced or paid,
 * editing or deleting it would corrupt the downstream delivery and billing
 * records, so those actions are hidden.
 *
 * After some goods have shipped (partial dispatch / dispatched / invoiced)
 * the operator can manually Close the order to mark it finished even though
 * the full quantity was never delivered. Close first checks whether the
 * order has actually been invoiced: if so it is set to 'invoiced' (catching
 * bills raised straight from stock that the auto-status trigger missed),
 * otherwise it is frozen as 'closed'. A Closed order is frozen — the
 * auto-status trigger leaves it alone — and the only forward action is to
 * Cancel it.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Loader2, CheckCircle2, Ban } from 'lucide-react';

const MODIFIABLE_STATUSES = new Set(['draft', 'pending_approval', 'approved']);
const CLOSABLE_STATUSES = new Set(['partial_dispatch', 'dispatched', 'invoiced']);

interface SoRowActionsProps {
  soId: number;
  soNumber: string;
  status: string;
}

export function SoRowActions({ soId, soNumber, status }: SoRowActionsProps): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const canModify = MODIFIABLE_STATUSES.has(status);
  const canClose = CLOSABLE_STATUSES.has(status);
  const isClosed = status === 'closed';

  async function updateStatus(next: 'cancelled', confirmMsg: string): Promise<void> {
    if (!window.confirm(confirmMsg)) {
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any;
    const { error } = await sb.from('sales_order').update({ status: next }).eq('id', soId);
    setBusy(false);
    if (error) {
      window.alert(`Could not update ${soNumber}: ${error.message}`);
      return;
    }
    router.refresh();
  }

  // Closing an order first checks whether it has actually been invoiced.
  // An invoice may be missed by the auto-status trigger when it is raised
  // straight from stock (not from the DC), so the order can sit in
  // partial_dispatch / dispatched even though it is billed. In that case we
  // move it to 'invoiced' rather than 'closed'. Only a genuinely un-invoiced
  // order is frozen as 'closed'.
  async function handleClose(): Promise<void> {
    if (!window.confirm(
      `Close order ${soNumber}? If it has already been invoiced it will be marked Invoiced; otherwise it is marked Closed and stops tracking deliveries.`,
    )) {
      return;
    }
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any;

    // Invoiced if any invoice points at this SO directly, or any DC linked
    // to the SO carries an invoice_id.
    const { data: directInv } = await sb
      .from('invoice').select('id').eq('so_id', soId).limit(1);
    let invoiced = (directInv?.length ?? 0) > 0;
    if (!invoiced) {
      const { data: dcInv } = await sb
        .from('delivery_challan').select('id')
        .eq('sales_order_id', soId).not('invoice_id', 'is', null).limit(1);
      invoiced = (dcInv?.length ?? 0) > 0;
    }

    const next: 'invoiced' | 'closed' = invoiced ? 'invoiced' : 'closed';
    const { error } = await sb.from('sales_order').update({ status: next }).eq('id', soId);
    setBusy(false);
    if (error) {
      window.alert(`Could not close ${soNumber}: ${error.message}`);
      return;
    }
    router.refresh();
  }

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

  if (canModify) {
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

  if (canClose) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => void handleClose()}
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium hover:bg-slate-100 text-slate-700 disabled:opacity-40"
          title={`Close ${soNumber}`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Close
        </button>
      </div>
    );
  }

  if (isClosed) {
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() =>
            void updateStatus(
              'cancelled',
              `Cancel closed order ${soNumber}? This marks it Cancelled.`,
            )
          }
          disabled={busy}
          className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium hover:bg-rose-50 text-rose-600 disabled:opacity-40"
          title={`Cancel ${soNumber}`}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ban className="w-4 h-4" />}
          Cancel
        </button>
      </div>
    );
  }

  return <span className="text-[11px] text-ink-mute">—</span>;
}
