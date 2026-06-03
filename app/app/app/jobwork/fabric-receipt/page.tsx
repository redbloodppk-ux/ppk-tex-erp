/**
 * Fabric Receipt list. Shows every receipt raised so far, newest first,
 * with date / party / source-DC / totals filters at the top. From here
 * the user can drill into a specific receipt to see the saved totals
 * and consumption snapshot.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Eye } from 'lucide-react';

export const metadata = { title: 'Fabric Receipts' };
export const dynamic = 'force-dynamic';

interface ReceiptRow {
  id: number;
  code: string;
  receipt_date: string;
  receipt_type: string;
  party_dc_no: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  status: string;
  remarks: string | null;
  party: { id: number; name: string; code: string } | null;
  dc: { id: number; code: string } | null;
}

interface PageProps {
  searchParams: Promise<{
    party?: string;
    from?: string;
    to?: string;
  }>;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return String(d.getDate()).padStart(2, '0') + '-' + months[d.getMonth()] + '-' + d.getFullYear();
}

function fmtMetres(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default async function FabricReceiptListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const partyId = sp.party && /^\d+$/.test(sp.party) ? Number(sp.party) : null;
  const fromDate = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const toDate   = sp.to   && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)   ? sp.to   : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let q = sb.from('fabric_receipt')
    .select(`
      id, code, receipt_date, receipt_type, party_dc_no,
      total_metres, total_pieces, status, remarks,
      party:party_id ( id, name, code ),
      dc:dc_id ( id, code )
    `)
    .order('receipt_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);

  if (partyId !== null) q = q.eq('party_id', partyId);
  if (fromDate !== null) q = q.gte('receipt_date', fromDate);
  if (toDate   !== null) q = q.lte('receipt_date', toDate);

  const { data, error } = await q;
  const rows = (data ?? []) as ReceiptRow[];

  // Active jobwork parties for the filter dropdown.
  const { data: ptRow } = await sb
    .from('party_type_master')
    .select('id')
    .eq('name', 'Jobwork Party')
    .maybeSingle();
  const jobworkTypeId: number | null = ptRow?.id ?? null;

  const { data: partyData } = await sb
    .from('party')
    .select('id, code, name, party_type_ids, party_type_id')
    .eq('status', 'active')
    .order('name');
  const allParties = (partyData ?? []) as Array<{
    id: number; code: string; name: string;
    party_type_ids: Array<number | string> | null;
    party_type_id: number | null;
  }>;
  const parties = jobworkTypeId == null
    ? allParties
    : allParties.filter((p) => {
        const ids = Array.isArray(p.party_type_ids) ? p.party_type_ids.map((x) => Number(x)) : [];
        return ids.includes(jobworkTypeId) || Number(p.party_type_id) === jobworkTypeId;
      });

  // KPI totals across the filtered rows.
  const totals = rows.reduce<{ m: number; p: number }>(
    (acc, r) => ({
      m: acc.m + Number(r.total_metres ?? 0),
      p: acc.p + (r.total_pieces ?? 0),
    }),
    { m: 0, p: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Fabric Receipts"
        subtitle="Inbound fabric from jobwork DCs. Click View to see the captured consumption snapshot."
        crumbs={[
          { label: 'Job Work', href: '/app/jobwork' },
          { label: 'Fabric Receipts' },
        ]}
        actions={
          <Link href="/app/jobwork" className="btn-secondary text-xs">
            Pick a DC to receive
          </Link>
        }
      />

      {/* Filter card */}
      <form action="/app/jobwork/fabric-receipt" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="party" className="text-[10px] uppercase tracking-wide text-ink-mute">Party</label>
          <select id="party" name="party" defaultValue={partyId !== null ? String(partyId) : ''} className="input py-1 text-xs min-w-[200px]">
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label htmlFor="from" className="text-[10px] uppercase tracking-wide text-ink-mute">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate ?? ''} className="input py-1 text-xs max-w-[150px]" />
        </div>
        <div className="flex flex-col">
          <label htmlFor="to" className="text-[10px] uppercase tracking-wide text-ink-mute">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate ?? ''} className="input py-1 text-xs max-w-[150px]" />
        </div>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        {(partyId !== null || fromDate !== null || toDate !== null) && (
          <Link href="/app/jobwork/fabric-receipt" className="text-xs text-ink-mute hover:text-ink underline self-center">
            Clear filters
          </Link>
        )}
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Receipts shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total metres</div>
          <div className="num text-xl font-bold">{fmtMetres(totals.m)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total pieces</div>
          <div className="num text-xl font-bold">{totals.p}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Distinct parties</div>
          <div className="num text-xl font-bold">{new Set(rows.map((r) => r.party?.id).filter(Boolean)).size}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load receipts: {error.message}</div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3">FR No</th>
              <th className="text-left  px-3 py-3">Date</th>
              <th className="text-left  px-3 py-3">Party</th>
              <th className="text-left  px-3 py-3">DC No</th>
              <th className="text-left  px-3 py-3">Type</th>
              <th className="text-right px-3 py-3">Metres</th>
              <th className="text-right px-3 py-3">Pieces</th>
              <th className="text-left  px-3 py-3">Remarks</th>
              <th className="text-right px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-ink-soft">
                  No fabric receipts yet. <Link href="/app/jobwork" className="text-indigo font-semibold">Pick a confirmed DC to receive &rarr;</Link>
                </td>
              </tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link href={`/app/jobwork/fabric-receipt/${r.id}`} className="text-indigo hover:underline">{r.code}</Link>
                </td>
                <td className="px-3 py-2 text-ink-soft">{fmtDate(r.receipt_date)}</td>
                <td className="px-3 py-2 font-medium">{r.party?.name ?? '-'}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {r.dc ? (
                    <Link href={`/app/delivery-challan/${r.dc.id}`} className="text-indigo hover:underline">{r.dc.code}</Link>
                  ) : (r.party_dc_no ?? '-')}
                </td>
                <td className="px-3 py-2 text-xs capitalize">{r.receipt_type}</td>
                <td className="px-3 py-2 text-right num">{fmtMetres(r.total_metres)}</td>
                <td className="px-3 py-2 text-right num">{r.total_pieces ?? 0}</td>
                <td className="px-3 py-2 text-xs text-ink-soft truncate max-w-[200px]">{r.remarks ?? '-'}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/app/jobwork/fabric-receipt/${r.id}`} className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex" title="View receipt">
                    <Eye className="w-4 h-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
