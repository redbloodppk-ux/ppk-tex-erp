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

type ProductionMode = 'inhouse' | 'jobwork' | 'outsource';

interface BatchRow {
  id: number;
  batch_code: string;
  start_date: string | null;
  end_date: string | null;
  produced_m: number;
  total_pieces: number | null;
  actual_true_cost_per_m: number | null;
  actual_sizing_cost_per_m: number | null;
  production_mode: ProductionMode | null;
  party_id: number | null;
  loom: { loom_code: string } | null;
  costing: { quality_code: string; quality_name: string; fabric_type: string | null } | null;
  party: { code: string; name: string } | null;
}

const MODE_LABEL: Record<ProductionMode, string> = {
  inhouse: 'In-house',
  jobwork: 'Job Work',
  outsource: 'Outsource',
};

const MODE_BADGE: Record<ProductionMode, string> = {
  inhouse: 'bg-indigo-50 text-indigo-700',
  jobwork: 'bg-amber-50 text-amber-700',
  outsource: 'bg-violet-50 text-violet-700',
};

function modeOf(b: BatchRow): ProductionMode {
  return b.production_mode === 'jobwork' || b.production_mode === 'outsource'
    ? b.production_mode
    : 'inhouse';
}

const MODE_FILTERS: { key: 'all' | ProductionMode; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'inhouse', label: 'In-house' },
  { key: 'jobwork', label: 'Job Work' },
  { key: 'outsource', label: 'Outsource' },
];

// ── Sale / payment status, derived per batch ──────────────────────────────
// A batch's produced fabric can leave the business two ways:
//   1. In-house batches deliver via a delivery_challan; the DC item carries
//      production_batch_id, and the DC may be linked to an invoice.
//   2. Job Work / Outsource batch fabric lands in fabric_stock and is sold
//      "Direct from Stock", so the invoice_line carries fabric_stock_id.
// We track HOW MUCH (metres) of each batch has been delivered, invoiced and
// paid so the status can tell apart a fully- vs partly-invoiced/-paid batch:
//   In Stock → Delivered → Part Invoiced → Invoiced → Part-paid → Paid
type SaleStatusKey =
  | 'in_stock'
  | 'delivered'
  | 'partial_invoiced'
  | 'invoiced'
  | 'part_paid'
  | 'paid';

const SALE_STATUS_META: Record<SaleStatusKey, { label: string; badge: string }> = {
  in_stock:         { label: 'In Stock',      badge: 'bg-slate-100 text-slate-600' },
  delivered:        { label: 'Delivered',     badge: 'bg-sky-50 text-sky-700' },
  partial_invoiced: { label: 'Part Invoiced', badge: 'bg-yellow-50 text-yellow-700' },
  invoiced:         { label: 'Invoiced',      badge: 'bg-amber-50 text-amber-700' },
  part_paid:        { label: 'Part-paid',     badge: 'bg-orange-50 text-orange-700' },
  paid:             { label: 'Paid',          badge: 'bg-emerald-50 text-emerald-700' },
};

// Per-batch metre tallies used to derive the status above.
interface BatchFlow {
  deliveredM: number;
  deliveredPcs: number;
  invoicedM: number;   // metres on a non-draft invoice (issued/overdue/partial/paid)
  partialM: number;    // metres whose invoice is partially paid
  paidM: number;       // metres whose invoice is fully paid
}

function emptyFlow(): BatchFlow {
  return { deliveredM: 0, deliveredPcs: 0, invoicedM: 0, partialM: 0, paidM: 0 };
}

// Render a quantity + pieces with each half in its own fixed-width,
// right-aligned slot so columns line up cleanly row to row. Towel qualities
// count their output in towels, not metres, so the unit label switches.
function QtyMP({ m, pcs, showPcs, towel }: { m: number; pcs: number | null; showPcs: boolean; towel?: boolean }) {
  return (
    <span className="num tabular-nums whitespace-nowrap inline-flex justify-end items-baseline gap-2">
      <span className="inline-block text-right min-w-[4rem]">{m.toFixed(0)} {towel ? 'towels' : 'm'}</span>
      {showPcs && (
        <span className="inline-block text-right min-w-[3rem] text-ink-mute">{pcs ?? 0} pcs</span>
      )}
    </span>
  );
}

// A towel batch records its towel-piece count in produced_m (not metres).
// A whole-number value confirms it's a towel count; a decimal means a real
// metre delivery, so it stays in metres.
function isTowelBatch(b: BatchRow): boolean {
  return b.costing?.fabric_type === 'towel' && Number.isInteger(Number(b.produced_m) || 0);
}

// Decide the furthest-along status for a batch from its metre tallies.
// EPS absorbs rounding so 799.9 of 800 still reads as "fully".
function deriveStatus(producedM: number, f: BatchFlow): SaleStatusKey {
  const EPS = 0.5;
  const fullyInvoiced = f.invoicedM >= producedM - EPS && f.invoicedM > 0;
  if (f.invoicedM <= EPS) {
    return f.deliveredM > EPS ? 'delivered' : 'in_stock';
  }
  if (f.paidM >= producedM - EPS && f.paidM > 0) return 'paid';
  if (f.paidM > EPS || f.partialM > EPS) return 'part_paid';
  return fullyInvoiced ? 'invoiced' : 'partial_invoiced';
}

interface VarianceRow {
  batch_id: number;
  variance_per_m: number | null;
  variance_total: number | null;
  actual_sizing_cost_per_m: number | null;
}

export default async function ProductionPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const supabase = await createClient();
  const sp = await searchParams;
  const activeMode: 'all' | ProductionMode =
    sp.mode === 'inhouse' || sp.mode === 'jobwork' || sp.mode === 'outsource'
      ? sp.mode
      : 'all';

  const [batchesRes, varianceRes] = await Promise.all([
    supabase
      .from('production_batch')
      .select(`
        id, batch_code, start_date, end_date, produced_m, total_pieces,
        actual_true_cost_per_m, actual_sizing_cost_per_m,
        production_mode, party_id,
        loom:loom_id ( loom_code ),
        costing:costing_id ( quality_code, quality_name, fabric_type ),
        party:party_id ( code, name )
      `)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('v_batch_sizing_variance')
      .select('batch_id, variance_per_m, variance_total, actual_sizing_cost_per_m'),
  ]);

  const allBatches = (batchesRes.data as unknown as BatchRow[]) ?? [];
  const batches =
    activeMode === 'all'
      ? allBatches
      : allBatches.filter((b) => modeOf(b) === activeMode);
  const variances = (varianceRes.data as unknown as VarianceRow[]) ?? [];
  const varianceByBatch = new Map<number, VarianceRow>();
  for (const v of variances) {
    if (v.batch_id != null) varianceByBatch.set(v.batch_id, v);
  }

  // ── Sale / payment flow per batch ───────────────────────────────────────
  // Two lineage paths feed the same flow tally per batch:
  //   delivered metres/pcs, invoiced metres, partial-paid metres, paid metres.
  // Invoiced metres count any non-draft/non-cancelled invoice; partial/paid
  // narrow that to payment progress. Status is then derived by quantity, so a
  // batch only partly invoiced reads "Part Invoiced", partly paid "Part-paid".
  const INVOICED_STATUSES = new Set(['issued', 'overdue', 'partial_paid', 'paid']);
  const batchIds = batches.map((b) => b.id);
  const flowByBatch = new Map<number, BatchFlow>();
  const getFlow = (batchId: number): BatchFlow => {
    let f = flowByBatch.get(batchId);
    if (!f) { f = emptyFlow(); flowByBatch.set(batchId, f); }
    return f;
  };
  if (batchIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;

    const tally = (
      batchId: number,
      metres: number,
      status: string | null | undefined,
    ): void => {
      const f = getFlow(batchId);
      if (status && INVOICED_STATUSES.has(status)) f.invoicedM += metres;
      if (status === 'partial_paid') f.partialM += metres;
      if (status === 'paid') f.paidM += metres;
    };

    // Path 1 — in-house batches delivered via DC.
    const { data: dciData } = await sb
      .from('delivery_challan_item')
      .select(
        'production_batch_id, metres, pieces, dc:dc_id ( cancelled_at, invoice:invoice_id ( status ) )',
      )
      .in('production_batch_id', batchIds);
    for (const row of (dciData ?? []) as Array<{
      production_batch_id: number | null;
      metres: number | null;
      pieces: number | null;
      dc: { cancelled_at: string | null; invoice: { status: string } | null } | null;
    }>) {
      if (row.production_batch_id == null) continue;
      if (!row.dc || row.dc.cancelled_at != null) continue; // skip cancelled DCs
      const m = Number(row.metres) || 0;
      const f = getFlow(row.production_batch_id);
      f.deliveredM += m;
      f.deliveredPcs += Number(row.pieces) || 0;
      tally(row.production_batch_id, m, row.dc.invoice?.status);
    }

    // Path 2 — job work / outsource batch fabric sold from fabric_stock.
    const { data: fsData } = await sb
      .from('fabric_stock')
      .select('id, batch_id, metres_out')
      .in('batch_id', batchIds);
    const fsRows = (fsData ?? []) as Array<{
      id: number;
      batch_id: number | null;
      metres_out: number | null;
    }>;
    const batchByFs = new Map<number, number>();
    for (const fs of fsRows) {
      if (fs.batch_id != null) {
        batchByFs.set(fs.id, fs.batch_id);
        getFlow(fs.batch_id).deliveredM += Number(fs.metres_out) || 0;
      }
    }
    const fsIds = fsRows.map((r) => r.id);
    if (fsIds.length > 0) {
      const { data: ilData } = await sb
        .from('invoice_line')
        .select('fabric_stock_id, quantity, invoice:invoice_id ( status )')
        .in('fabric_stock_id', fsIds);
      for (const row of (ilData ?? []) as Array<{
        fabric_stock_id: number | null;
        quantity: number | null;
        invoice: { status: string } | null;
      }>) {
        if (row.fabric_stock_id == null) continue;
        const batchId = batchByFs.get(row.fabric_stock_id);
        if (batchId == null) continue;
        tally(batchId, Number(row.quantity) || 0, row.invoice?.status);
      }
    }
  }

  // Resolve each batch to a single status key for rendering.
  const statusByBatch = new Map<number, SaleStatusKey>();
  for (const b of batches) {
    const f = flowByBatch.get(b.id) ?? emptyFlow();
    statusByBatch.set(b.id, deriveStatus(Number(b.produced_m) || 0, f));
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

        {/* Mode filter pills */}
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {MODE_FILTERS.map((f) => {
            const isActive = activeMode === f.key;
            const href = f.key === 'all' ? '/app/production' : `/app/production?mode=${f.key}`;
            return (
              <Link
                key={f.key}
                href={href}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  isActive
                    ? 'bg-indigo text-white border-indigo'
                    : 'bg-white text-ink-soft border-line hover:bg-cloud/40'
                }`}
              >
                {f.label}
              </Link>
            );
          })}
        </div>

        {batchesRes.error && (
          <div className="card p-4 text-sm text-err mb-4">
            Could not load batches: {batchesRes.error.message}
          </div>
        )}

        {batches.length === 0 ? (
          <div className="card p-10 text-center text-ink-soft text-sm">
            <Factory className="w-6 h-6 mx-auto mb-2 text-ink-mute" />
            {activeMode === 'all'
              ? 'No production batches yet. Once a loom finishes a beam, record the batch here.'
              : `No ${MODE_LABEL[activeMode].toLowerCase()} batches yet.`}
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/app/production/${b.id}/edit`}
                          className="font-mono font-semibold text-ink hover:text-indigo break-words"
                        >
                          {b.batch_code}
                        </Link>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${MODE_BADGE[modeOf(b)]}`}>
                          {MODE_LABEL[modeOf(b)]}
                        </span>
                        {(() => {
                          const s = SALE_STATUS_META[statusByBatch.get(b.id) ?? 'in_stock'];
                          return (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>
                              {s.label}
                            </span>
                          );
                        })()}
                      </div>
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
                      {(() => {
                        const towel = isTowelBatch(b);
                        const unit = towel ? 'towels' : 'm';
                        const f = flowByBatch.get(b.id) ?? emptyFlow();
                        const balM = (Number(b.produced_m) || 0) - f.deliveredM;
                        const balPcs = (b.total_pieces ?? 0) - f.deliveredPcs;
                        return (
                          <>
                            <div className="text-[10px] uppercase tracking-wide text-ink-mute">Produced</div>
                            <div className="num font-semibold text-base">
                              {Number(b.produced_m).toFixed(0)} {unit}
                              {b.total_pieces != null && (
                                <span className="text-sm font-normal text-ink-mute"> · {b.total_pieces} pcs</span>
                              )}
                            </div>
                            <div className="text-[10px] uppercase tracking-wide text-ink-mute mt-1">Balance</div>
                            <div className="num text-sm text-ink-soft">
                              {balM.toFixed(0)} {unit}
                              {b.total_pieces != null && <> · {balPcs} pcs</>}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>

                  {modeOf(b) !== 'inhouse' && (
                    <div className="text-xs text-ink-soft mt-2">
                      <span className="text-ink-mute">
                        {modeOf(b) === 'jobwork' ? 'Jobwork party: ' : 'Outsource weaver: '}
                      </span>
                      <span className="font-semibold">{b.party?.name ?? '—'}</span>
                    </div>
                  )}
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
                  <th className="text-left px-3 py-2">Mode</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Quality</th>
                  <th className="text-left px-3 py-2">Loom / Party</th>
                  <th className="text-left px-3 py-2">Dates</th>
                  <th className="text-right px-3 py-2">Produced</th>
                  <th className="text-right px-3 py-2">Balance</th>
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
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${MODE_BADGE[modeOf(b)]}`}>
                          {MODE_LABEL[modeOf(b)]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {(() => {
                          const s = SALE_STATUS_META[statusByBatch.get(b.id) ?? 'in_stock'];
                          return (
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${s.badge}`}>
                              {s.label}
                            </span>
                          );
                        })()}
                      </td>
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
                      <td className="px-3 py-2 text-xs">
                        {modeOf(b) === 'inhouse' ? (
                          <span className="font-mono">
                            {b.loom?.loom_code ?? <span className="text-ink-mute">—</span>}
                          </span>
                        ) : (
                          <span className="font-semibold">{b.party?.name ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink-soft">
                        {b.start_date ?? '—'} → {b.end_date ?? 'open'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <QtyMP
                          m={Number(b.produced_m) || 0}
                          pcs={b.total_pieces}
                          showPcs={b.total_pieces != null}
                          towel={isTowelBatch(b)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-ink-soft">
                        {(() => {
                          const f = flowByBatch.get(b.id) ?? emptyFlow();
                          const balM = (Number(b.produced_m) || 0) - f.deliveredM;
                          const balPcs = (b.total_pieces ?? 0) - f.deliveredPcs;
                          return <QtyMP m={balM} pcs={balPcs} showPcs={b.total_pieces != null} towel={isTowelBatch(b)} />;
                        })()}
                      </td>
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
