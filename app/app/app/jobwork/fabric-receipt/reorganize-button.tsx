'use client';
/**
 * Button that triggers reorganizeFabricReceipts(): removes duplicates
 * (keeps the latest per DC, reverses their stock), then renumbers every
 * surviving FR code to match the source DC code, then clears all
 * stock_snapshot fields so a subsequent Backfill run regenerates them
 * from scratch in order.
 *
 * Destructive: pops a confirm dialog before running.
 */
import { useState, useTransition } from 'react';
import { Loader2, ArrowDownUp, AlertTriangle } from 'lucide-react';
import { reorganizeFabricReceipts, type ReorganizeResult } from './actions';

export function ReorganizeReceiptsButton(): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<ReorganizeResult | null>(null);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);

  function handleClick(): void {
    setShowConfirm(false);
    setResult(null);
    startTransition(async () => {
      try {
        const res = await reorganizeFabricReceipts();
        setResult(res);
      } catch (err) {
        setResult({
          duplicates_removed: 0, renumbered: 0, skipped: 0,
          error: err instanceof Error ? err.message : 'Reorganize failed.',
        });
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={isPending}
        className="btn-secondary text-xs"
        title="Remove duplicate receipts and renumber FR codes to match the source DC code (FR/26-27/NNNN = JDC's NNNN)"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowDownUp className="w-3.5 h-3.5" />}
        Reorganize
      </button>
      {result && (
        <span className="text-xs text-ink-soft">
          {result.error ? (
            <span className="text-rose-700">{result.error}</span>
          ) : (
            <>Removed <b>{result.duplicates_removed}</b> duplicates · Renumbered <b>{result.renumbered}</b> · Skipped {result.skipped}. Click <b>Backfill snapshots</b> next.</>
          )}
        </span>
      )}

      {showConfirm && (
        <div className="fixed inset-0 bg-ink/40 z-50 flex items-center justify-center p-4">
          <div className="card max-w-md p-5 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-none mt-0.5" />
              <div>
                <h3 className="font-display font-bold text-sm">Reorganize fabric receipts?</h3>
                <p className="text-xs text-ink-soft mt-1">
                  This will:
                </p>
                <ul className="text-xs text-ink-soft list-disc list-inside mt-1 space-y-0.5">
                  <li>Remove duplicate receipts per DC (keeps the latest, reverses stock for the rest).</li>
                  <li>Renumber every surviving FR code to mirror its source DC: JDC/26-27/0001 → FR/26-27/0001.</li>
                  <li>Clear all stock snapshots so the next Backfill run regenerates them in order.</li>
                </ul>
                <p className="text-xs text-rose-700 mt-2 font-semibold">Cannot be undone. Take a Supabase backup first.</p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowConfirm(false)} className="btn-secondary text-xs">
                Cancel
              </button>
              <button type="button" onClick={handleClick} className="btn-primary text-xs">
                Yes, reorganize
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
