/**
 * Production — production_batch listing.
 *
 * The Fabric Receipt form (app/production/new) creates a production_batch row,
 * which fires the cost-snapshot triggers (005 / 006 / 007). This page is the
 * read-side: most-recent first, with a quick view of the snapshotted True
 * Cost so the owner can spot batches whose actual rupees/m drifted from costing.
 *
 * Sizing variance comes from v_batch_sizing_variance (CORR-T4) — we join it
 * here so the table can show the planned-vs-actual delta inline.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, AlertTriangle, CheckCircle2, Factory } from 'lucide-react';

export const metadata = { title: 'Production' };
export const dynamic = 'force-dynamic';

interface BatchRow {
  id: number;
  batch_code: string;
  start_date: string | null;
  end_date: string | null;
  produced_m: number;
  rejected_m: number;
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
        id, batch_code, start_date, end_date, produced_m, rejected_m,
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

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="Fabric Receipt batches. Each batch snapshots the costing on insert so stock valuation never drifts."
        actions={
          <Link href="/app/production/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Fabric Receipt
          </Link>
        }
      />

      {batchesRes.error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load batches: {batchesRes.error.message}
        </div>
      )}

      {batches.length === 0 ? (
        <div className="card p-10 text-center text-ink-soft text-sm">
          <Factory className="w-6 h-6 mx-auto mb-2 text-ink-mute" />
          No production batches yet. Once a loom finishes a beam, record the receipt here.
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-ink-mute bg-cloud/40">
              <tr>
                <th className="text-left px-3 py-2">Batch</th>
                <th className="text-left px-3 py-2">Quality</th>
                <th className="text-left px-3 py-2">Loom</th>
                <th className="text-left px-3 py-2">Dates</th>
                <th className="text-right px-3 py-2">Produced m</th>
                <th className="text-right px-3 py-2">Rejected m</th>
                <th className="text-right px-3 py-2">True rupees/m</th>
                <th className="text-right px-3 py-2">Sizing variance</th>
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
                    <td className="px-3 py-2 text-right num text-ink-soft">
                      {Number(b.rejected_m).toFixed(0)}
                    </td>
                    <td className="px-3 py-2 text-right num">
                      {b.actual_true_cost_per_m != null
                        ? `₹${Number(b.actual_true_cost_per_m).toFixed(2)}`
                        : <span className="text-ink-mute">—</span>}
                    </td>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
