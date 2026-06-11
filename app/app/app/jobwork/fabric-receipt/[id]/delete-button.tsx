'use client';
/**
 * "Delete" button for a saved fabric receipt. Confirms, then calls
 * cancelFabricReceipt(): every stock reduction is restored (warp /
 * weft / porvai pools topped back up, bobbin ledger outflows removed),
 * the receipt + its items + its ledger rows are deleted, and the
 * source DC is freed (fabric_receipt_id cleared, status back to
 * draft) — so the 1 DC : 1 fabric receipt rule holds and the DC can
 * be receipted again.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { cancelFabricReceipt } from './actions';

interface DeleteButtonProps {
  receiptId: number;
  receiptCode: string;
  dcCode?: string | null;
}

export function DeleteReceiptButton({ receiptId, receiptCode, dcCode }: DeleteButtonProps): React.ReactElement {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete(): void {
    setError(null);
    setShowConfirm(false);
    startTransition(async () => {
      const res = await cancelFabricReceipt(receiptId);
      if (!res.ok) {
        setError(res.error ?? 'Could not delete the receipt.');
        return;
      }
      router.push('/app/jobwork/fabric-receipt');
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={isPending}
        title="Delete this receipt — stock is restored and the DC becomes free"
        className="btn-secondary text-xs text-rose-700"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        Delete
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4">
          <div className="card max-w-md p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 flex-none mt-0.5" />
              <div>
                <h3 className="font-display font-bold text-sm">Delete receipt {receiptCode}?</h3>
                <p className="text-xs text-ink-soft mt-1">
                  All stock this receipt consumed (warp metres, weft / porvai yarn, bobbin metres) will be
                  put back, and DC <span className="font-mono">{dcCode ?? ''}</span> becomes free for a new
                  fabric receipt. The receipt code <span className="font-mono">{receiptCode}</span> is
                  retired — this cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="btn-secondary text-xs">
                Cancel
              </button>
              <button type="button" onClick={handleDelete} className="btn-primary text-xs bg-rose-600 hover:bg-rose-700">
                Yes, delete &amp; restore stock
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1 z-10">
          {error}
        </div>
      )}
    </>
  );
}
