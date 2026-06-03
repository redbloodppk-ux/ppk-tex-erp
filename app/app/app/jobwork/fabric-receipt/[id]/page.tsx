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

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<{ title: string }> {
  const { id } = await params;
  return { title: `Fabric Receipt ${id}` };
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

  const [hdrRes, itemRes] = await Promise.all([
    sb.from('fabric_receipt')
      .select(`
        id, code, receipt_date, receipt_type, party_dc_no, remarks,
        total_metres, total_pieces, status,
        party:party_id ( id, name, code, gstin ),
        dc:dc_id ( id, code, dc_date )
      `)
      .eq('id', numericId)
      .maybeSingle(),
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
          <Link
            href="/app/jobwork/fabric-receipt"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-haze/60"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to list
          </Link>
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
