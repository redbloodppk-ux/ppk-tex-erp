'use client';
/**
 * Button that triggers rebuildStockLedgerFromReceipts() — derives
 * stock_ledger outflow rows from fabric_receipt_item data for any
 * receipt that doesn't yet have ledger entries. Once populated, the
 * Warehouse jobwork pivot tabs can sort inflows + outflows by date and
 * compute an accurate per-event running balance.
 */
import { useState, useTransition } from 'react';
import { Loader2, History } from 'lucide-react';
import { rebuildStockLedgerFromReceipts, type RebuildLedgerResult } from './actions';

export function RebuildLedgerButton(): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RebuildLedgerResult | null>(null);

  function handleClick(): void {
    setResult(null);
    startTransition(async () => {
      try {
        const res = await rebuildStockLedgerFromReceipts();
        setResult(res);
      } catch (err) {
        setResult({
          receipts_scanned: 0, receipts_rebuilt: 0, ledger_rows_inserted: 0,
          error: err instanceof Error ? err.message : 'Rebuild failed.',
        });
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="btn-secondary text-xs"
        title="Backfill stock_ledger outflow rows from fabric_receipt_item history so the warehouse pivot shows accurate chronological running balances"
      >
        {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
        Rebuild ledger
      </button>
      {result && (
        <span className="text-xs text-ink-soft">
          {result.error ? (
            <span className="text-rose-700">{result.error}</span>
          ) : (
            <>Scanned {result.receipts_scanned} receipts, rebuilt <b>{result.receipts_rebuilt}</b>, inserted {result.ledger_rows_inserted} ledger rows.</>
          )}
        </span>
      )}
    </div>
  );
}
