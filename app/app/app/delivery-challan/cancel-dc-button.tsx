'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, X, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

/**
 * Cancel a Delivery Challan.
 *
 * What cancelling does (server-side, see migration 220 /
 * fn_cancel_delivery_challan):
 *   • Reverses the production-batch stock the DC consumed, restoring it to
 *     the ORIGINAL batch.
 *   • If the operator picks a different target batch, the returned stock is
 *     relocated to that batch.
 *   • Frees the DC number so the next DC reuses it (when "Reuse this number"
 *     stays ticked and this DC holds the latest issued number).
 *
 * This button is rendered in two places (the `variant` prop styles each):
 *   • 'icon'   — compact icon for the DC list row actions.
 *   • 'button' — labelled button for the DC edit-page header.
 *
 * The target-batch picker only appears for in-house DCs that were actually
 * cut from a production batch; for everything else we just collect a reason
 * and the reuse-number choice.
 */

interface BatchOpt {
  id: number;
  label: string;
}

interface CostingOpt {
  id: number;
  label: string;
}

interface CancelDcButtonProps {
  dcId: number;
  code: string | null;
  productionMode: 'inhouse' | 'jobwork' | 'outsource';
  variant?: 'icon' | 'button';
}

export function CancelDcButton({
  dcId,
  code,
  productionMode,
  variant = 'icon',
}: CancelDcButtonProps) {
  const router = useRouter();
  const supabase = createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [batchOpts, setBatchOpts] = useState<BatchOpt[]>([]);
  const [origBatchId, setOrigBatchId] = useState<number | null>(null);
  const [targetBatchId, setTargetBatchId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [reuseNumber, setReuseNumber] = useState(true);

  // Manual-entry DC → "move to batch" on cancel. When the DC's items aren't
  // tied to any production batch, we offer to auto-create a batch (dated to
  // the DC) and post the delivered metres into it as available stock. A batch
  // is costing-anchored, so the operator picks the quality/costing — it's
  // pre-selected when the fabric already carries one.
  const [isManual, setIsManual] = useState(false);
  const [moveToBatch, setMoveToBatch] = useState(true);
  const [costingOpts, setCostingOpts] = useState<CostingOpt[]>([]);
  const [manualCostingId, setManualCostingId] = useState<string>('');

  async function openDialog() {
    setOpen(true);
    setError(null);
    setReason('');
    setReuseNumber(true);
    setTargetBatchId('');
    setBatchOpts([]);
    setOrigBatchId(null);
    setIsManual(false);
    setMoveToBatch(true);
    setCostingOpts([]);
    setManualCostingId('');

    setLoading(true);
    try {
      // 1. The DC's items — which batch fed them, what quality, how much.
      const { data: itemRows } = await sb
        .from('delivery_challan_item')
        .select('production_batch_id, fabric_quality_id, metres')
        .eq('dc_id', dcId);
      const items = (itemRows ?? []) as Array<{
        production_batch_id: number | null;
        fabric_quality_id: number | null;
        metres: number | string | null;
      }>;

      const origBatchIds = Array.from(
        new Set(
          items
            .map((it) => it.production_batch_id)
            .filter((v): v is number => v != null),
        ),
      );

      // Manual entry → no batch behind any item. Offer to auto-create a batch
      // on cancel and post the delivered metres into it. Applies to every mode.
      if (origBatchIds.length === 0) {
        const hasMetres = items.some((it) => Number(it.metres ?? 0) > 0);
        if (!hasMetres) {
          setLoading(false);
          return;
        }
        setIsManual(true);

        // Default costing = the costing carried by the DC's fabric quality
        // (often NULL for manually-entered fabric — then the operator picks).
        const qualityIds = Array.from(
          new Set(
            items
              .map((it) => it.fabric_quality_id)
              .filter((v): v is number => v != null),
          ),
        );
        let defaultCosting: number | null = null;
        if (qualityIds.length > 0) {
          const { data: fqRows } = await sb
            .from('fabric_quality')
            .select('id, costing_id')
            .in('id', qualityIds);
          for (const fq of (fqRows ?? []) as Array<{
            id: number;
            costing_id: number | null;
          }>) {
            if (fq.costing_id != null) {
              defaultCosting = fq.costing_id;
              break;
            }
          }
        }

        // All costings as options for the new batch.
        const { data: cmRows } = await sb
          .from('costing_master')
          .select('id, quality_code, quality_name')
          .order('quality_code', { ascending: true });
        const opts: CostingOpt[] = (
          (cmRows ?? []) as Array<{
            id: number;
            quality_code: string | null;
            quality_name: string | null;
          }>
        ).map((c) => ({
          id: c.id,
          label: c.quality_code ?? c.quality_name ?? `Costing #${c.id}`,
        }));
        setCostingOpts(opts);
        setManualCostingId(defaultCosting != null ? String(defaultCosting) : '');

        setLoading(false);
        return;
      }
      const firstOrig = origBatchIds[0] ?? null;

      // Only in-house DCs need the relocate picker below. Batch-linked
      // jobwork / outsource DCs restore their own batch automatically.
      if (productionMode !== 'inhouse') {
        setLoading(false);
        return;
      }
      setOrigBatchId(firstOrig);
      setTargetBatchId(firstOrig != null ? String(firstOrig) : '');

      const qualityIds = Array.from(
        new Set(
          items
            .map((it) => it.fabric_quality_id)
            .filter((v): v is number => v != null),
        ),
      );

      // 2. Costings carrying those qualities → batches of the same quality
      //    are the sensible relocation targets.
      let costingIds: number[] = [];
      if (qualityIds.length > 0) {
        const { data: fqRows } = await sb
          .from('fabric_quality')
          .select('costing_id')
          .in('id', qualityIds);
        costingIds = Array.from(
          new Set(
            ((fqRows ?? []) as Array<{ costing_id: number | null }>)
              .map((r) => r.costing_id)
              .filter((v): v is number => v != null),
          ),
        );
      }

      // 3. Candidate batches: same-quality batches, plus the original (so it
      //    always appears even if its costing didn't resolve a quality).
      let batchQuery = sb
        .from('production_batch')
        .select('id, batch_code, costing_id')
        .order('batch_code', { ascending: false });
      if (costingIds.length > 0) {
        batchQuery = batchQuery.in('costing_id', costingIds);
      } else {
        batchQuery = batchQuery.in('id', origBatchIds);
      }
      const { data: batchRows } = await batchQuery;
      let batches = (batchRows ?? []) as Array<{
        id: number;
        batch_code: string;
        costing_id: number;
      }>;

      // Make sure the original batch is always selectable.
      if (firstOrig != null && !batches.some((b) => b.id === firstOrig)) {
        const { data: origRow } = await sb
          .from('production_batch')
          .select('id, batch_code, costing_id')
          .eq('id', firstOrig)
          .maybeSingle();
        if (origRow) batches = [origRow, ...batches];
      }

      // Quality labels for nicer option text.
      const cIds = Array.from(new Set(batches.map((b) => b.costing_id)));
      const cmLabel = new Map<number, string>();
      if (cIds.length > 0) {
        const { data: cmRows } = await sb
          .from('costing_master')
          .select('id, quality_code, quality_name')
          .in('id', cIds);
        for (const c of (cmRows ?? []) as Array<{
          id: number;
          quality_code: string | null;
          quality_name: string | null;
        }>) {
          cmLabel.set(c.id, c.quality_code ?? c.quality_name ?? '');
        }
      }

      const opts: BatchOpt[] = batches.map((b) => {
        const q = cmLabel.get(b.costing_id);
        const isOrig = b.id === firstOrig;
        return {
          id: b.id,
          label:
            `${b.batch_code}${q ? ` · ${q}` : ''}` +
            (isOrig ? ' (original)' : ''),
        };
      });
      setBatchOpts(opts);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load batches.');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCancel() {
    if (isManual && moveToBatch && !manualCostingId) {
      setError('Pick the quality for the new batch, or untick "move to batch".');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const targetId = targetBatchId ? Number(targetBatchId) : null;
      // Only send a target when it actually differs from the original —
      // otherwise the function would write a pointless same-batch transfer.
      const pTarget =
        targetId != null && targetId !== origBatchId ? targetId : null;

      // Manual DC: move the delivered metres into a freshly-created batch.
      const wantMove = isManual && moveToBatch;
      const pManualCosting =
        wantMove && manualCostingId ? Number(manualCostingId) : null;

      const { error: rpcErr } = await sb.rpc('fn_cancel_delivery_challan', {
        p_dc_id: dcId,
        p_target_batch_id: pTarget,
        p_reason: reason.trim() || null,
        p_reuse_number: reuseNumber,
        p_move_manual_to_batch: wantMove,
        p_manual_costing_id: pManualCosting,
      });
      if (rpcErr) {
        setError(rpcErr.message ?? 'Cancel failed.');
        setBusy(false);
        return;
      }
      setOpen(false);
      setBusy(false);
      router.refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Cancel failed.');
      setBusy(false);
    }
  }

  const trigger =
    variant === 'button' ? (
      <button
        type="button"
        onClick={openDialog}
        className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
        title="Cancel this delivery challan"
      >
        <Ban className="w-3.5 h-3.5" /> Cancel DC
      </button>
    ) : (
      <button
        type="button"
        onClick={openDialog}
        className="p-1 rounded hover:bg-rose-50 text-rose-600 inline-flex ml-1"
        title="Cancel this delivery challan"
      >
        <Ban className="w-4 h-4" />
      </button>
    );

  return (
    <>
      {trigger}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">
                Cancel DC {code ?? ''}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="p-1 rounded hover:bg-haze text-ink-soft"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-4 py-4 space-y-4">
              <p className="text-xs text-ink-soft">
                Cancelling reverses the stock this DC consumed and frees its
                number for reuse. This cannot be undone.
              </p>

              {loading ? (
                <div className="flex items-center gap-2 text-xs text-ink-soft">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading
                  batches…
                </div>
              ) : (
                <>
                  {batchOpts.length > 0 && (
                    <div>
                      <label className="block text-xs font-semibold text-ink-soft mb-1">
                        Return stock to batch
                      </label>
                      <select
                        value={targetBatchId}
                        onChange={(e) => setTargetBatchId(e.target.value)}
                        className="w-full rounded-md border border-line px-2 py-1.5 text-sm"
                      >
                        {batchOpts.map((b) => (
                          <option key={b.id} value={String(b.id)}>
                            {b.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[11px] text-ink-mute">
                        Defaults to the original batch. Pick another to relocate
                        the returned fabric.
                      </p>
                    </div>
                  )}

                  {isManual && (
                    <div className="rounded-md border border-line bg-haze/40 p-3 space-y-2">
                      <label className="flex items-start gap-2 text-xs text-ink">
                        <input
                          type="checkbox"
                          checked={moveToBatch}
                          onChange={(e) => setMoveToBatch(e.target.checked)}
                          className="mt-0.5 rounded border-line"
                        />
                        <span>
                          Move this fabric to a new batch
                          <span className="block text-[11px] text-ink-mute font-normal">
                            This DC was entered manually (no batch). On cancel
                            we&apos;ll create a batch dated to the DC and put its
                            metres in as available stock.
                          </span>
                        </span>
                      </label>

                      {moveToBatch && (
                        <div>
                          <label className="block text-xs font-semibold text-ink-soft mb-1">
                            Quality for the new batch
                          </label>
                          <select
                            value={manualCostingId}
                            onChange={(e) => setManualCostingId(e.target.value)}
                            className="w-full rounded-md border border-line px-2 py-1.5 text-sm"
                          >
                            <option value="">Select quality…</option>
                            {costingOpts.map((c) => (
                              <option key={c.id} value={String(c.id)}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-[11px] text-ink-mute">
                            Pre-filled when the fabric already has a costing.
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-ink-soft mb-1">
                  Reason (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-line px-2 py-1.5 text-sm"
                  placeholder="Why is this DC being cancelled?"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={reuseNumber}
                  onChange={(e) => setReuseNumber(e.target.checked)}
                  className="rounded border-line"
                />
                Reuse this DC number for the next DC
              </label>

              {error && (
                <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
              >
                Keep DC
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={busy || loading}
                className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Cancel this DC
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
