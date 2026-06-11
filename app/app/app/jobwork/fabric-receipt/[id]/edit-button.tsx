'use client';
/**
 * "Edit" button for a saved fabric receipt. Clicking it pops a confirm
 * dialog, then reverses the receipt's stock effects and frees the DC —
 * but KEEPS the receipt header, so the same receipt code is reused
 * when the corrected entry is saved.
 *
 * On confirm we call editFabricReceipt(); on success we redirect the
 * user to /app/jobwork/fabric-receipt/new?dc=<id>&receipt=<id> so the
 * form re-enters under the existing receipt code.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Pencil, AlertTriangle } from 'lucide-react';
import { editFabricReceipt } from './actions';

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
      const res = await editFabricReceipt(receiptId);
      if (!res.ok) {
        setError(res.error ?? 'Could not prepare the receipt for editing.');
        return;
      }
      // Take the operator to the entry form for the same DC, carrying
      // the receipt id so the corrected entry is saved under the SAME
      // receipt code.
      const targetDc = res.dc_id ?? dcId;
      if (targetDc) {
        router.push(`/app/jobwork/fabric-receipt/new?dc=${targetDc}&receipt=${receiptId}`);
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
                  Stock that was reduced will be restored. You&apos;ll be taken to the entry form pre-loaded with the source DC, and on save the corrected receipt keeps the same code{' '}
                  <span className="font-mono">{receiptCode}</span>. The DC remains locked to this receipt the whole time — no other receipt can use it.
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
