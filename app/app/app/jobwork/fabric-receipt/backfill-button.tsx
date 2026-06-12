'use client';
/**
 * Button that triggers backfillStockSnapshots() for every fabric
 * receipt missing a stock_snapshot. Shows a small status row after the
 * run completes.
 */
import { useState, useTransition } from 'react';
import { Loader2, History } from 'lucide-react';
import { backfillStockSnapshots, type BackfillResult } from './actions';

export function BackfillSnapshotsButton(): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<BackfillResult | null>(null);

  function run(): void {
    if (!window.confirm(
      'Rebuild the stock snapshot on EVERY receipt from current stock? '
      + 'Existing snapshots will be overwritten with negative-aware figures.',
    )) return;
    setResult(null);
    startTransition(async () => {
      try {
        const res = await backfillStockSnapshots(true);
        setResult(res);
      } catch (err) {
        setResult({
          scanned: 0, updated: 0, skipped: 0,
          error: err instanceof Error ? err.message : 'Backfill failed.',
        });
      }
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={run}
        disabled={isPending}
        className="btn-secondary text-xs"
        title="Recompute the snapshot on EVERY receipt (overwrites existing ones) — shows negative balances where stock was over-consumed"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
        Rebuild all snapshots
      </button>
      {result && (
        <span className="text-xs text-ink-soft">
          {result.error ? (
            <span className="text-rose-700">{result.error}</span>
          ) : (
            <>Scanned {result.scanned}, updated <b>{result.updated}</b>, skipped {result.skipped}.</>
          )}
        </span>
      )}
    </div>
  );
}
