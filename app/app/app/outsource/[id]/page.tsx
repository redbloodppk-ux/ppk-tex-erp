/**
 * Outsource Order detail + "Record fabric received" action (CORR-P5)
 *
 * Server component shell that loads the OW header + existing linked batches
 * and renders the client-side delivery form. Marking a delivery:
 *   1. Inserts a production_batch row with:
 *        - outsource_order_id = this OW
 *        - loom_id = NULL (vendor weave, not in-house)
 *        - actual_pick_cost_per_m = ow.pick_paise_agreed (snapshot)
 *        - actual_warp/weft/porvai/bobbin lots = copied from the OW
 *      (other actual_* columns are filled by the snapshot trigger)
 *   2. Increments outsource_order.delivered_metres and flips status to
 *      'partial' or 'complete' depending on totals.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ArrowLeft } from 'lucide-react';
import { formatRupee } from '@/lib/utils';
import { ReceiveFabricForm } from './receive-fabric-form';

export const metadata = { title: 'Outsource Order' };
export const dynamic = 'force-dynamic';

interface OWDetail {
  id: number;
  ow_number: string;
  ledger_id: number;
  costing_id: number;
  warp_lot_id: number | null;
  weft_lot_id: number | null;
  porvai_lot_id: number | null;
  bobbin_1_id: number | null;
  bobbin_1_pcs_issued: number;
  expected_metres: number;
  delivered_metres: number;
  pick_paise_agreed: number;
  issued_date: string;
  promised_date: string | null;
  bobbin_pcs_returned: number;
  status: 'open' | 'partial' | 'complete' | 'cancelled';
  notes: string | null;
  vendor: { name: string; code: string | null } | null;
  costing: { quality_code: string; quality_name: string } | null;
}

interface LinkedBatch {
  id: number;
  batch_code: string;
  end_date: string | null;
  produced_m: number;
  rejected_m: number;
  actual_pick_cost_per_m: number | null;
  actual_true_cost_per_m: number | null;
}

export default async function OutsourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const owId = Number(id);
  if (!Number.isInteger(owId) || owId <= 0) notFound();

  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('outsource_order')
    .select(`
      id, ow_number, ledger_id, costing_id,
      warp_lot_id, weft_lot_id, porvai_lot_id, bobbin_1_id, bobbin_1_pcs_issued,
      expected_metres, delivered_metres, pick_paise_agreed,
      issued_date, promised_date, bobbin_pcs_returned, status, notes,
      vendor:ledger_id ( name, code ),
      costing:costing_id ( quality_code, quality_name )
    `)
    .eq('id', owId)
    .maybeSingle();

  const ow = data as unknown as OWDetail | null;
  if (!ow) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: batches } = await (supabase as any)
    .from('production_batch')
    .select('id, batch_code, end_date, produced_m, rejected_m, actual_pick_cost_per_m, actual_true_cost_per_m')
    .eq('outsource_order_id', owId)
    .order('end_date', { ascending: false });

  const linked = (batches as unknown as LinkedBatch[]) ?? [];
  const totalReceived = linked.reduce((a, b) => a + Number(b.produced_m || 0), 0);
  const remaining = Math.max(0, Number(ow.expected_metres) - Number(ow.delivered_metres));

  return (
    <div>
      <PageHeader
        title={ow.ow_number}
        subtitle={`${ow.vendor?.name ?? '—'} · ${ow.costing?.quality_code ?? ''} ${ow.costing?.quality_name ?? ''}`}
        crumbs={[{ label: 'Outsource', href: '/app/outsource' }, { label: ow.ow_number }]}
        actions={
          <Link href="/app/outsource" className="btn-ghost">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>
        }
      />

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        <div className="card p-4 space-y-2 text-sm">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Order</h3>
          <div className="grid grid-cols-2 gap-y-1">
            <div className="text-ink-mute">Issued</div><div className="num">{ow.issued_date}</div>
            <div className="text-ink-mute">Promised</div><div className="num">{ow.promised_date ?? '—'}</div>
            <div className="text-ink-mute">Expected</div><div className="num">{Number(ow.expected_metres).toFixed(0)} m</div>
            <div className="text-ink-mute">Delivered</div><div className="num font-semibold">{Number(ow.delivered_metres).toFixed(0)} m</div>
            <div className="text-ink-mute">Remaining</div><div className="num">{remaining.toFixed(0)} m</div>
            <div className="text-ink-mute">Pick ₹/m</div><div className="num font-semibold text-indigo">{formatRupee(Number(ow.pick_paise_agreed))}</div>
            <div className="text-ink-mute">Status</div><div className="capitalize">{ow.status}</div>
          </div>
          {ow.notes && (
            <div className="pt-2 text-xs text-ink-soft border-t border-line/40">{ow.notes}</div>
          )}
        </div>

        <div className="card p-4 space-y-2 text-sm">
          <h3 className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Yarn issued</h3>
          <div className="grid grid-cols-2 gap-y-1">
            <div className="text-ink-mute">Warp lot</div><div className="num">{ow.warp_lot_id ?? '—'}</div>
            <div className="text-ink-mute">Weft lot</div><div className="num">{ow.weft_lot_id ?? '—'}</div>
            <div className="text-ink-mute">Porvai lot</div><div className="num">{ow.porvai_lot_id ?? '—'}</div>
            <div className="text-ink-mute">Bobbin 1</div><div className="num">{ow.bobbin_1_id ?? '—'}</div>
            <div className="text-ink-mute">Bobbin pcs issued</div><div className="num">{Number(ow.bobbin_1_pcs_issued).toFixed(2)}</div>
            <div className="text-ink-mute">Bobbin pcs returned</div><div className="num">{Number(ow.bobbin_pcs_returned).toFixed(2)}</div>
          </div>
        </div>
      </div>

      {ow.status !== 'complete' && ow.status !== 'cancelled' && (
        <ReceiveFabricForm
          owId={ow.id}
          owNumber={ow.ow_number}
          costingId={ow.costing_id}
          pickPaiseAgreed={Number(ow.pick_paise_agreed)}
          warpLotId={ow.warp_lot_id}
          weftLotId={ow.weft_lot_id}
          porvaiLotId={ow.porvai_lot_id}
          bobbin1Id={ow.bobbin_1_id}
          expectedM={Number(ow.expected_metres)}
          deliveredSoFar={Number(ow.delivered_metres)}
        />
      )}

      <div className="card overflow-x-auto mt-4">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-4 py-3">Batch #</th>
              <th className="text-left px-4 py-3">Received on</th>
              <th className="text-right px-4 py-3">Produced m</th>
              <th className="text-right px-4 py-3">Rejected m</th>
              <th className="text-right px-4 py-3">Pick ₹/m</th>
              <th className="text-right px-4 py-3">True cost ₹/m</th>
            </tr>
          </thead>
          <tbody>
            {linked.length ? linked.map(b => (
              <tr key={b.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{b.batch_code}</td>
                <td className="px-4 py-3 num text-xs">{b.end_date ?? '—'}</td>
                <td className="px-4 py-3 text-right num font-semibold">{Number(b.produced_m).toFixed(0)}</td>
                <td className="px-4 py-3 text-right num">{Number(b.rejected_m).toFixed(0)}</td>
                <td className="px-4 py-3 text-right num">{formatRupee(Number(b.actual_pick_cost_per_m ?? 0))}</td>
                <td className="px-4 py-3 text-right num text-indigo font-semibold">
                  {formatRupee(Number(b.actual_true_cost_per_m ?? 0))}
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-ink-soft">
                  No fabric received yet. Use the form above to record the first delivery.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {linked.length > 0 && (
          <div className="border-t border-line/40 px-4 py-2 text-xs text-ink-soft text-right">
            Total received across batches: <span className="num font-semibold">{totalReceived.toFixed(0)} m</span>
          </div>
        )}
      </div>
    </div>
  );
}
