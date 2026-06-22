/**
 * Production — production_batch cost-snapshot listing.
 *
 * The production_batch table is the cost-snapshot ledger
 * (triggers 005 / 006 / 007).
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  Plus,
  AlertTriangle,
  CheckCircle2,
  Factory,
  Pencil,
} from 'lucide-react';
import { ProductionBatchDeleteButton } from '@/app/components/production-batch-delete-button';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Production' };
export const dynamic = 'force-dynamic';

interface BatchRow {
  id: number;
  batch_code: string;
  start_date: string | null;
  end_date: string | null;
  produced_m: number;
  actual_true_cost_per_m: number | null;
  actual_sizing_cost_per_m: number | null;
  loom: { loom_code: string } | null;
  costing: { quality_code: string; quality_name: string } | null;
}

interface VarianceRow {
  batch_id: number;
  variance_per_m: number | null;
  variance_total: number | null;
  actual_sizing_cost_per_m: number | null;
}

export default async function ProductionPage() {
  const supabase = await createClient();

  const [batchesRes, varianceRes] = await Promise.all([
    supabase
      .from('production_batch')
      .select(`
        id, batch_code, start_date, end_date, produced_m,
        actual_true_cost_per_m, actual_sizing_cost_per_m,
        loom:loom_id ( loom_code ),
        costing:costing_id ( quality_code, quality_name )
      `)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('v_batch_sizing_variance')
      .select('batch_id, variance_per_m, variance_total, actual_sizing_cost_per_m'),
  ]);

  const batches = (batchesRes.data as unknown as BatchRow[]) ?? [];
  const variances = (varianceRes.data as unknown as VarianceRow[]) ?? [];
  const varianceByBatch = new Map<number, VarianceRow>();
  for (const v of variances) {
    if (v.batch_id != null) varianceByBatch.set(v.batch_id, v);
  }

  // Hide cost columns that have no data yet (true cost is only snapshotted
  // for fully-wired costings; sizing variance only exists for batches linked
  // to a pavu assign). Show each column once at least one batch populates it.
  const showTrueCost = batches.some((b) => b.actual_true_cost_per_m != null);
  const showVariance = batches.some(
    (b) => varianceByBatch.get(b.id)?.variance_per_m != null,
  );

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="In-house production batches. Costing is snapshotted at insert so stock valuation never drifts."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/app/jobwork/fabric-receipt?tab=inhouse"
              className="btn-secondary text-xs"
            >
              View in-house receipts
            </Link>
            <Link href="/app/production/new" className="btn-primary">
              <Plus className="w-4 h-4" /> New Production Batch
            </Link>
          </div>
        }
      />

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Production batches (cost-snapshot listing)                       */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display font-bold text-sm mb-2">
          Production Batches <span className="text-ink-mute">· cost snapshots</span>
        </h2>

        {batchesRes.error && (
          <div className="card p-4 text-sm text-err mb-4">
            Could not load batches: {batchesRes.error.message}
          </div>
        )}

        {batches.length === 0 ? (
          <div className="card p-10 text-center text-ink-soft text-sm">
            <Factory className="w-6 h-6 mx-auto mb-2 text-ink-mute" />
            No production batches yet. Once a loom finishes a beam, record the batch here.
          </div>
        ) : (
          <>
          {/* Mobile / PWA: card view. The batch table is wide; on a phone we
              show each batch as a tap-friendly card. Hidden from md up, where
              the full table below takes over. */}
          <CardFilter placeholder="Search batches…">
            {batches.map((b) => {
              const v = varianceByBatch.get(b.id);
              const variancePerM = v?.variance_per_m ?? null;
              const hasVariance = variancePerM !== null;
              const isOverrun = hasVariance && Number(variancePerM) > 0.01;
              const isSaving = hasVariance && Number(variancePerM) < -0.01;
              return (
                <div key={b.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/app/production/${b.id}/edit`}
                        className="font-mono font-semibold text-ink hover:text-indigo break-words"
                      >
                        {b.batch_code}
                      </Link>
                      <div className="text-xs text-ink-soft mt-0.5">
                        {b.costing ? (
                          <>
                            <span className="font-semibold">{b.costing.quality_code}</span>
                            <span className="text-ink-mute"> — {b.costing.quality_name}</span>
                          </>
                        ) : (
                          <span className="text-ink-mute">—</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wide text-ink-mute">Produced</div>
                      <div className="num font-semibold text-base">{Number(b.produced_m).toFixed(0)} m</div>
                    </div>
                  </div>

                  <div className="text-xs text-ink-soft mt-2">
                    <span className="text-ink-mute">Loom: </span>
                    <span className="font-mono">{b.loom?.loom_code ?? '—'}</span>
                    <span className="mx-1">·</span>
                    {b.start_date ?? '—'} → {b.end_date ?? 'open'}
                  </div>
                  {showTrueCost && b.actual_true_cost_per_m != null && (
                    <div className="text-xs mt-1">
                      <span className="text-ink-mute">True rupees/m: </span>
                      <span className="num">₹{Number(b.actual_true_cost_per_m).toFixed(2)}</span>
                    </div>
                  )}
                  {showVariance && hasVariance && (
                    <div className="text-xs mt-1">
                      <span className="text-ink-mute">Sizing variance: </span>
                      {isOverrun ? (
                        <span className="inline-flex items-center gap-1 text-amber-700">
                          <AlertTriangle className="w-3 h-3" />
                          +₹{Number(variancePerM).toFixed(2)}/m
                        </span>
                      ) : isSaving ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="w-3 h-3" />
                          ₹{Number(variancePerM).toFixed(2)}/m
                        </span>
                      ) : (
                        <span className="text-ink-soft">on plan</span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                    <Link
                      href={`/app/production/${b.id}/edit`}
                      className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
                      title="Edit this batch"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Link>
                    <ProductionBatchDeleteButton id={b.id} code={b.batch_code} />
                  </div>
                </div>
              );
            })}
          </CardFilter>

          <div className="card p-0 overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
                <tr>
                  <th className="text-left px-3 py-2">Batch</th>
                  <th className="text-left px-3 py-2">Quality</th>
                  <th className="text-left px-3 py-2">Loom</th>
                  <th className="text-left px-3 py-2">Dates</th>
                  <th className="text-right px-3 py-2">Produced m</th>
                  {showTrueCost && (
                    <th className="text-right px-3 py-2">True rupees/m</th>
                  )}
                  {showVariance && (
                    <th className="text-right px-3 py-2">Sizing variance</th>
                  )}
                  <th className="text-right px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {batches.map(b => {
                  const v = varianceByBatch.get(b.id);
                  const variancePerM = v?.variance_per_m ?? null;
                  const hasVariance = variancePerM !== null;
                  const isOverrun = hasVariance && Number(variancePerM) > 0.01;
                  const isSaving = hasVariance && Number(variancePerM) < -0.01;
                  return (
                    <tr key={b.id} className="border-t border-line/40">
                      <td className="px-3 py-2 font-mono font-semibold">{b.batch_code}</td>
                      <td className="px-3 py-2">
                        {b.costing ? (
                          <>
                            <span className="font-semibold">{b.costing.quality_code}</span>
                            <span className="text-ink-mute"> — {b.costing.quality_name}</span>
                          </>
                        ) : (
                          <span className="text-ink-mute">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {b.loom?.loom_code ?? <span className="text-ink-mute">—</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-soft">
                        {b.start_date ?? '—'} → {b.end_date ?? 'open'}
                      </td>
                      <td className="px-3 py-2 text-right num">{Number(b.produced_m).toFixed(0)}</td>
                      {showTrueCost && (
                        <td className="px-3 py-2 text-right num">
                          {b.actual_true_cost_per_m != null
                            ? `₹${Number(b.actual_true_cost_per_m).toFixed(2)}`
                            : <span className="text-ink-mute">—</span>}
                        </td>
                      )}
                      {showVariance && (
                        <td className="px-3 py-2 text-right text-xs">
                          {!hasVariance ? (
                            <span className="text-ink-mute">N/A</span>
                          ) : isOverrun ? (
                            <span className="inline-flex items-center gap-1 text-amber-700">
                              <AlertTriangle className="w-3 h-3" />
                              +₹{Number(variancePerM).toFixed(2)}/m
                            </span>
                          ) : isSaving ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700">
                              <CheckCircle2 className="w-3 h-3" />
                              ₹{Number(variancePerM).toFixed(2)}/m
                            </span>
                          ) : (
                            <span className="text-ink-soft">on plan</span>
                          )}
                        </td>
                      )}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Link
                          href={`/app/production/${b.id}/edit`}
                          className="p-1 rounded hover:bg-indigo-50 text-indigo inline-flex mr-1"
                          title="Edit this batch"
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <ProductionBatchDeleteButton id={b.id} code={b.batch_code} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>
  );
}
