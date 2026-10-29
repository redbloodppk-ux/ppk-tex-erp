'use client';
/** Trash icon on the General Purchases list — deletes one bill (and its
 *  item lines) after a confirm, then refreshes the list. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { appConfirm, appAlert } from '@/lib/app-dialog';

export function DeleteGeneralPurchaseButton({ id, billNo, label = false }: { id: number; billNo: string; label?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onDelete(): Promise<void> {
    if (busy) return;
    if (!(await appConfirm(`Delete general purchase bill ${billNo}? It is removed from the Purchase Register and cannot be undone.`))) return;
    setBusy(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any;
    const { error: itemErr } = await sb.from('general_purchase_item').delete().eq('general_purchase_id', id);
    if (itemErr) { setBusy(false); await appAlert(`Could not delete: ${itemErr.message}`); return; }
    const { error } = await sb.from('general_purchase').delete().eq('id', id);
    if (error) { setBusy(false); await appAlert(`Could not delete: ${error.message}`); return; }
    router.refresh();
  }

  return (
    <button type="button" onClick={() => void onDelete()} disabled={busy}
      className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 font-semibold p-1 rounded hover:bg-rose-50 disabled:opacity-50"
      title="Delete bill">
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
      {label && 'Delete'}
    </button>
  );
}
