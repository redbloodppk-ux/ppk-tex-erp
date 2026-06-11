/**
 * Fabric Receipt detail (read-only for now). Shows the saved header +
 * items with the consumption snapshot the form captured. Editing a
 * receipt is intentionally a bigger task because stock has already been
 * decremented - that's a Phase 3 feature with an "undo + re-apply"
 * round-trip.
 */
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { EditReceiptButton } from './edit-button';
import { DeleteReceiptButton } from './delete-button';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Fabric Receipt ${id}` };
}

interface StockSnapshotJson {
  warp_beam?:   { before_m?: number;  consumed_m?: number;  after_m?: number  };
  weft_yarn?:   { before_kg?: number; consumed_kg?: number; after_kg?: number };
  porvai_yarn?: { before_kg?: number; consumed_kg?: number; after_kg?: number };
  bobbin?:      { before_m?: number;  consumed_m?: number;  after_m?: number };
}

interface ReceiptRow {
  id: number;
  code: string;
  receipt_date: string;
  receipt_type: string;
  party_dc_no: string | null;
  remarks: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  status: string;
  stock_snapshot: StockSnapshotJson | null;
  party: { id: number; name: string; code: string; gstin: string | null } | null;
  dc: { id: number; code: string; dc_date: string } | null;
}

interface ItemRow {
  id: number;
  sno: number;
  fabric_quality_id: number | null;
  ends_count_snapshot: number | null;
  no_of_pieces: number | null;
  length_per_pc: number | string | null;
  received_metres: number | string;
  entry_mode: string;
  weft_kg_per_m: number | string | null;
  weft_consumed_kg: number | string | null;
  porvai_kg_per_m: number | string | null;
  porvai_consumed_kg: number | string | null;
  bobbin_pcs_per_m: number | string | null;
  bobbin_consumed_pcs: number | string | null;
  product: string | null;
  qty: number | string | null;
  quality: { id: number; code: string; name: string } | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function fmtNum(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function FabricReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Try with stock_snapshot. If migration 091 isn't applied yet that
  // column doesn't exist - fall back to a select without it.
  const baseHdrCols = `
    id, code, receipt_date, receipt_type, party_dc_no, remarks,
    total_metres, total_pieces, status,
    party:party_id ( id, name, code, gstin ),
    dc:dc_id ( id, code, dc_date )
  `;
  const tryHdr = async (includeSnapshot: boolean) =>
    sb.from('fabric_receipt')
      .select(includeSnapshot ? baseHdrCols.replace('status,', 'status, stock_snapshot,') : baseHdrCols)
      .eq('id', numericId)
      .maybeSingle();
  const [hdrRes, itemRes] = await Promise.all([
    (async () => {
      const first = await tryHdr(true);
      if (first.error && /stock_snapshot/i.test(first.error.message ?? '')) {
        return await tryHdr(false);
      }
      return first;
    })(),
    sb.from('fabric_receipt_item')
      .select(`
        id, sno, fabric_quality_id, ends_count_snapshot,
        no_of_pieces, length_per_pc, received_metres, entry_mode,
        weft_kg_per_m, weft_consumed_kg,
        porvai_kg_per_m, porvai_consumed_kg,
        bobbin_pcs_per_m, bobbin_consumed_pcs,
        product, qty,
        quality:fabric_quality_id ( id, code, name )
      `)
      .eq('receipt_id', numericId)
      .order('sno'),
  ]);

  const hdr = hdrRes.data as ReceiptRow | null;
  if (!hdr) notFound();
  const items = (itemRes.data ?? []) as ItemRow[];

  // Aggregate consumption totals
  const totals = items.reduce<{ m: number; weft: number; porvai: number; bobbin: number }>(
    (acc, it) => ({
      m:      acc.m      + Number(it.received_metres ?? 0),
      weft:   acc.weft   + Number(it.weft_consumed_kg ?? 0),
      porvai: acc.porvai + Number(it.porvai_consumed_kg ?? 0),
      bobbin: acc.bobbin + Number(it.bobbin_consumed_pcs ?? 0),
    }),
    { m: 0, weft: 0, porvai: 0, bobbin: 0 },
  );

  return (
    <div>
      <PageHeader
        title={`Fabric Receipt ${hdr.code}`}
        subtitle={`${hdr.party?.name ?? '-'} \u00b7 from DC ${hdr.dc?.code ?? hdr.party_dc_no ?? '-'}`}
        crumbs={[
          { label: 'Job Work', href: '/app/jobwork' },
          { label: 'Fabric Receipts', href: '/app/jobwork/fabric-receipt' },
          { label: hdr.code },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <EditReceiptButton receiptId={hdr.id} receiptCode={hdr.code} dcId={hdr.dc?.id ?? null} />
            <DeleteReceiptButton receiptId={hdr.id} receiptCode={hdr.code} dcCode={hdr.dc?.code ?? null} />
            <Link
              href="/app/jobwork/fabric-receipt"
              className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Back to list
            </Link>
          </div>
        }
      />

      {/* Header summary */}
      <div className="card p-4 mb-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Receipt no</div>
          <div className="num font-bold font-mono">{hdr.code}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Date</div>
          <div className="num font-bold">{fmtDate(hdr.receipt_date)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Type</div>
          <div className="num font-bold capitalize">{hdr.receipt_type}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Source DC</div>
          <div className="num font-bold font-mono">
            {hdr.dc ? (
              <Link href={`/app/delivery-challan/${hdr.dc.id}`} className="text-indigo hover:underline">{hdr.dc.code}</Link>
            ) : (hdr.party_dc_no ?? '-')}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Status</div>
          <div className="num font-bold capitalize">{hdr.status}</div>
        </div>
      </div>

      {/* Party block */}
      <div className="card p-4 mb-4">
        <h2 className="font-display font-bold text-sm mb-2">Received from</h2>
        <div className="text-sm space-y-0.5">
          <div className="font-semibold">{hdr.party?.name ?? '-'}</div>
          <div className="text-xs text-ink-soft">{hdr.party?.code ?? ''}</div>
          {hdr.party?.gstin && <div className="text-xs text-ink-soft">GSTIN: {hdr.party.gstin}</div>}
        </div>
      </div>

      {/* Stock transaction snapshot - before/after per bucket */}
      <StockSnapshotCard snapshot={hdr.stock_snapshot} />

      {/* Items */}
      <div className="card overflow-x-auto mb-4">
        <div className="px-4 py-3 border-b border-line/60 bg-cloud/40">
          <h2 className="font-display font-bold text-sm">Items</h2>
        </div>
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-2">SNo</th>
              <th className="text-left  px-3 py-2">Quality</th>
              <th className="text-right px-3 py-2">Ends</th>
              <th className="text-right px-3 py-2">Pieces</th>
              <th className="text-right px-3 py-2">Received metres</th>
              <th className="text-right px-3 py-2">Weft kg</th>
              <th className="text-right px-3 py-2">Porvai kg</th>
              <th className="text-right px-3 py-2">Bobbin m</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-mute">No items.</td></tr>
            ) : items.map((it) => (
              <tr key={it.id} className="border-t border-line/40 align-top">
                <td className="px-3 py-2 text-xs text-ink-mute">{it.sno}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-xs">{it.quality?.code ?? '-'}</div>
                  {it.quality?.name && <div className="text-[10px] text-ink-mute">{it.quality.name}</div>}
                </td>
                <td className="px-3 py-2 text-right num text-xs">
                  {it.ends_count_snapshot ?? <span className="text-ink-mute">nil</span>}
                </td>
                <td className="px-3 py-2 text-right num text-xs">{it.no_of_pieces ?? 0}</td>
                <td className="px-3 py-2 text-right num text-xs font-semibold text-indigo-700">
                  {fmtNum(it.received_metres)}
                  {it.entry_mode === 'pcs' && it.length_per_pc != null && (
                    <div className="text-[10px] text-ink-mute font-normal">
                      = {it.no_of_pieces ?? 0} pcs &times; {fmtNum(it.length_per_pc)} m
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-right num text-xs">
                  {Number(it.weft_consumed_kg ?? 0) > 0
                    ? fmtNum(it.weft_consumed_kg)
                    : <span className="text-ink-mute">nil</span>}
                </td>
                <td className="px-3 py-2 text-right num text-xs">
                  {Number(it.porvai_consumed_kg ?? 0) > 0
                    ? fmtNum(it.porvai_consumed_kg)
                    : <span className="text-ink-mute">nil</span>}
                </td>
                <td className="px-3 py-2 text-right num text-xs">
                  {Number(it.bobbin_consumed_pcs ?? 0) > 0
                    ? fmtNum(it.bobbin_consumed_pcs)
                    : <span className="text-ink-mute">nil</span>}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line bg-cloud/30 font-semibold">
            <tr>
              <td className="px-3 py-2" colSpan={4}>Totals</td>
              <td className="px-3 py-2 text-right num">{fmtNum(totals.m)} m</td>
              <td className="px-3 py-2 text-right num">{fmtNum(totals.weft)}</td>
              <td className="px-3 py-2 text-right num">{fmtNum(totals.porvai)}</td>
              <td className="px-3 py-2 text-right num">{fmtNum(totals.bobbin)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Remarks */}
      {hdr.remarks && (
        <div className="card p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute mb-1">Remarks</div>
          <div className="text-sm whitespace-pre-line">{hdr.remarks}</div>
        </div>
      )}
    </div>
  );
}

/** Render the receipt's stock transaction snapshot as a before / after
 *  table for the four jobwork buckets (warp metre, weft yarn, porvai
 *  yarn, bobbin). Captured at receipt save time, so it freezes the
 *  exact stock movement this transaction caused. */
function StockSnapshotCard({ snapshot }: { snapshot: StockSnapshotJson | null }): React.ReactElement {
  if (!snapshot) {
    return (
      <div className="card p-4 mb-4 border-l-4 border-l-amber-400 bg-amber-50/30">
        <div className="text-[11px] uppercase tracking-wide text-amber-700 mb-1">Stock transaction</div>
        <div className="text-xs text-ink-soft">
          No snapshot stored on this receipt - the receipt was saved before the snapshot feature was enabled, or migration 091 has not been applied. New receipts capture before/after automatically.
        </div>
      </div>
    );
  }
  const rows: Array<{ label: string; unit: 'm' | 'kg'; before: number; consumed: number; after: number }> = [
    { label: 'Warp metre',  unit: 'm',  before: snapshot.warp_beam?.before_m   ?? 0, consumed: snapshot.warp_beam?.consumed_m   ?? 0, after: snapshot.warp_beam?.after_m   ?? 0 },
    { label: 'Weft yarn',   unit: 'kg', before: snapshot.weft_yarn?.before_kg  ?? 0, consumed: snapshot.weft_yarn?.consumed_kg  ?? 0, after: snapshot.weft_yarn?.after_kg  ?? 0 },
    { label: 'Porvai yarn', unit: 'kg', before: snapshot.porvai_yarn?.before_kg?? 0, consumed: snapshot.porvai_yarn?.consumed_kg?? 0, after: snapshot.porvai_yarn?.after_kg?? 0 },
    { label: 'Bobbin',      unit: 'm',  before: snapshot.bobbin?.before_m      ?? 0, consumed: snapshot.bobbin?.consumed_m      ?? 0, after: snapshot.bobbin?.after_m      ?? 0 },
  ];
  return (
    <div className="card overflow-hidden mb-4">
      <div className="px-4 py-3 border-b border-line/60 bg-cloud/40 flex items-baseline justify-between">
        <h2 className="font-display font-bold text-sm">Stock transaction</h2>
        <span className="text-[11px] text-ink-soft">Captured at save time; pooled across merged-delivery siblings.</span>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="text-left  px-4 py-2">Bucket</th>
            <th className="text-right px-4 py-2">Before</th>
            <th className="text-right px-4 py-2">Consumed</th>
            <th className="text-right px-4 py-2">After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-line/40">
              <td className="px-4 py-2 font-medium">{r.label}</td>
              <td className="px-4 py-2 text-right num">{fmtNum(r.before)} {r.unit}</td>
              <td className="px-4 py-2 text-right num text-rose-700">
                {r.consumed > 0 ? '\u2212 ' + fmtNum(r.consumed) + ' ' + r.unit : '-'}
              </td>
              <td className={'px-4 py-2 text-right num font-semibold ' + (r.after < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                {fmtNum(r.after)} {r.unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
