/**
 * Production — production_batch listing PLUS an in-house "Pending
 * Fabric Receipts" panel.
 *
 * The Pending panel mirrors the jobwork DC tab: it lists every active
 * delivery_challan where production_mode = 'inhouse' that hasn't been
 * received yet, with a Receive Fabric icon on each row. Clicking the
 * icon opens the same fabric receipt form used for jobwork / outsource
 * DCs, so the in-house workflow looks and feels identical.
 *
 * The existing production_batch table below is the cost-snapshot ledger
 * (triggers 005 / 006 / 007). It's left untouched.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  Plus,
  AlertTriangle,
  CheckCircle2,
  Factory,
  PackageCheck,
  Printer,
  Pencil,
} from 'lucide-react';
import { ProductionBatchDeleteButton } from '@/app/components/production-batch-delete-button';

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

interface PendingDcRow {
  id: number;
  code: string;
  dc_date: string;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
  bill_to_name: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
  fabric_receipt_id: number | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtMetres(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function statusPill(s: PendingDcRow['status']): { label: string; cls: string } {
  switch (s) {
    case 'draft':     return { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' };
    case 'confirmed': return { label: 'Confirmed', cls: 'bg-amber-50 text-amber-700' };
    case 'invoiced':  return { label: 'Invoiced',  cls: 'bg-emerald-50 text-emerald-700' };
    case 'cancelled': return { label: 'Cancelled', cls: 'bg-rose-50 text-rose-700' };
    default:          return { label: s,           cls: 'bg-slate-100 text-slate-600' };
  }
}

export default async function ProductionPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [batchesRes, varianceRes, pendingDcRes] = await Promise.all([
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
    // Pending fabric receipts = in-house DCs that haven't been received
    // yet and aren't cancelled / invoiced.
    sb
      .from('delivery_challan')
      .select(
        'id, code, dc_date, status, bill_to_name, total_metres, total_pieces, total_bundles, fabric_receipt_id'
      )
      .eq('production_mode', 'inhouse')
      .is('fabric_receipt_id', null)
      .in('status', ['draft', 'confirmed'])
      .order('dc_date', { ascending: false })
      .order('id', { ascending: false })
      .limit(100),
  ]);

  const batches = (batchesRes.data as unknown as BatchRow[]) ?? [];
  const variances = (varianceRes.data as unknown as VarianceRow[]) ?? [];
  const pendingDcs = (pendingDcRes.data as unknown as PendingDcRow[]) ?? [];
  const varianceByBatch = new Map<number, VarianceRow>();
  for (const v of variances) {
    if (v.batch_id != null) varianceByBatch.set(v.batch_id, v);
  }

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="In-house production batches and pending fabric receipts. Costing is snapshotted at insert so stock valuation never drifts."
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
      {/* Pending Fabric Receipts — in-house DCs awaiting receipt          */}
      {/* ──────────────────────────────────────────────────────────────── */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-bold text-sm">
            Pending Fabric Receipts <span className="text-ink-mute">· in-house DCs</span>
          </h2>
          <span className="text-xs text-ink-mute">
            {pendingDcs.length} DC{pendingDcs.length === 1 ? '' : 's'} awaiting receipt
          </span>
        </div>

        {pendingDcRes.error && (
          <div className="card p-3 mb-3 text-err text-xs">
            Could not load in-house DCs: {pendingDcRes.error.message}
          </div>
        )}

        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">DC No</th>
                <th className="text-left  px-3 py-3">Date</th>
                <th className="text-left  px-3 py-3">Party (Bill-To)</th>
                <th className="text-right px-3 py-3">Metres</th>
                <th className="text-right px-3 py-3">Pcs</th>
                <th className="text-right px-3 py-3">Bundles</th>
                <th className="text-left  px-3 py-3">Status</th>
                <th className="text-right px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {pendingDcs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-ink-soft text-sm">
                    No in-house DCs are pending fabric receipt. <Link
                      href="/app/delivery-challan/new"
                      className="text-indigo font-semibold"
                    >Create a new DC &rarr;</Link>
                  </td>
                </tr>
              ) : (
                pendingDcs.map((r) => {
                  const pill = statusPill(r.status);
                  return (
                    <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                      <td className="px-3 py-2 font-mono text-xs">
                        <Link
                          href={`/app/delivery-challan/${r.id}`}
                          className="text-indigo hover:underline"
                        >
                          {r.code}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-ink-soft">{fmtDate(r.dc_date)}</td>
                      <td className="px-3 py-2 font-medium">{r.bill_to_name ?? '-'}</td>
                      <td className="px-3 py-2 text-right num">{fmtMetres(r.total_metres)}</td>
                      <td className="px-3 py-2 text-right num">{r.total_pieces ?? 0}</td>
                      <td className="px-3 py-2 text-right num">{r.total_bundles ?? 0}</td>
                      <td className="px-3 py-2">
                        <span className={`pill ${pill.cls} text-xs uppercase tracking-wide`}>{pill.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <Link
                          href={`/app/jobwork/fabric-receipt/new?dc=${r.id}`}
                          className="p-1 rounded hover:bg-teal-50 text-teal-700 inline-flex mr-1"
                          title="Receive fabric from this DC"
                        >
                          <PackageCheck className="w-4 h-4" />
                        </Link>
                        <Link
                          href={`/app/delivery-challan/${r.id}/print`}
                          target="_blank"
                          className="p-1 rounded hover:bg-emerald-50 text-emerald-700 inline-flex"
                          title="View / Print DC"
                        >
                          <Printer className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ──────────────────────────────────────────────────────────────── */}
      {/* Production batches (existing cost-snapshot listing)              */}
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
        )}
      </section>
    </div>
  );
}
