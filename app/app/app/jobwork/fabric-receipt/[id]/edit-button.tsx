'use client';
/**
 * "Edit" button for a saved fabric receipt. Clicking it pops a confirm
 * dialog (the action is destructive: stock will be restored, ledger
 * rows removed, items deleted, then the DC freed for a fresh receipt).
 *
 * On confirm we call cancelFabricReceipt(); on success we redirect the
 * user to /app/jobwork/fabric-receipt/new?dc=<id> pre-loaded with the
 * source DC so they can re-enter the receipt cleanly.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, AlertTriangle } from 'lucide-react';
import { cancelFabricReceipt } from './actions';

interface EditButtonProps {
  receiptId: number;
  receiptCode: string;
  dcId: number | null;
}

export function EditReceiptButton({ receiptId, receiptCode, dcId }: EditButtonProps): React.ReactElement {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleEdit(): void {
    setError(null);
    setShowConfirm(false);
    startTransition(async () => {
      const res = await cancelFabricReceipt(receiptId);
      if (!res.ok) {
        setError(res.error ?? 'Could not cancel the receipt.');
        return;
      }
      // Take the operator to the new-receipt form for the same DC so
      // they can re-enter the corrected values.
      const targetDc = res.dc_id ?? dcId;
      if (targetDc) {
        router.push(`/app/jobwork/fabric-receipt/new?dc=${targetDc}`);
      } else {
        router.push('/app/jobwork/fabric-receipt');
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={isPending}
        className="btn-secondary text-xs"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5" />}
        Edit
      </button>

      {showConfirm && (
        <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4">
          <div className="card max-w-md p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-none mt-0.5" />
              <div>
                <h3 className="font-display font-bold text-sm">Edit receipt {receiptCode}?</h3>
                <p className="text-xs text-ink-soft mt-1">
                  Editing will cancel this receipt: stock that was reduced will be restored, the source DC will be freed for a new receipt, and you&apos;ll be taken to a fresh entry form pre-loaded with that DC. The receipt code{' '}
                  <span className="font-mono">{receiptCode}</span> will not be reused.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="btn-secondary text-xs">
                Cancel
              </button>
              <button type="button" onClick={handleEdit} className="btn-primary text-xs">
                Yes, edit
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute mt-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {error}
        </div>
      )}
    </>
  );
}
