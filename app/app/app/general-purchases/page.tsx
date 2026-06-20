/**
 * /app/general-purchases — General Purchase GST bills.
 *
 * Catch-all supplier bills (packing material, spares, consumables,
 * services) that aren't yarn / bobbin / sizing / fabric / weaving.
 * Each bill is a single taxable amount + GST %, and feeds the Purchase
 * Register (source = 'general') keyed off the supplier's invoice date.
 *
 * Register-only: no payment tracking.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil, FileText } from 'lucide-react';
import { formatRupee } from '@/lib/utils';

export const metadata = { title: 'General Purchases' };
export const dynamic = 'force-dynamic';

interface GeneralPurchaseRow {
  id: number;
  bill_no: string;
  bill_date: string;
  description: string | null;
  taxable: number | string;
  gst_pct: number | string;
  total: number | string;
  status: string;
  party: { name: string | null; code: string | null } | null;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

export default async function GeneralPurchasesListPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data } = await sb
    .from('general_purchase')
    .select('id, bill_no, bill_date, description, taxable, gst_pct, total, status, party:supplier_party_id ( name, code )')
    .eq('status', 'active')
    .order('bill_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(300);
  const rows = (data ?? []) as GeneralPurchaseRow[];

  const taxableTotal = rows.reduce((s, r) => s + Number(r.taxable), 0);
  const grandTotal   = rows.reduce((s, r) => s + Number(r.total), 0);

  return (
    <div>
      <PageHeader
        title="General Purchases"
        subtitle="Catch-all supplier GST bills (packing, spares, consumables, services). Appears in the Purchase Register — register only, no payment tracking."
        actions={
          <Link href="/app/general-purchases/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New General Purchase
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-mute">Bills</div>
          <div className="num font-bold text-lg">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-mute">Taxable</div>
          <div className="num font-bold text-lg">{formatRupee(taxableTotal)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total with GST</div>
          <div className="num font-bold text-lg text-indigo">{formatRupee(grandTotal)}</div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
              <th className="px-3 py-2">Bill No</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Supplier</th>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Taxable</th>
              <th className="px-3 py-2 text-right">GST %</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-ink-mute">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No general purchase bills yet. Click <strong>New General Purchase</strong> to add one.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/40 hover:bg-cloud/40">
                <td className="px-3 py-2 font-mono">{r.bill_no}</td>
                <td className="px-3 py-2 whitespace-nowrap">{fmtDate(r.bill_date)}</td>
                <td className="px-3 py-2">{r.party?.name ?? '—'}</td>
                <td className="px-3 py-2 text-ink-soft">{r.description ?? '—'}</td>
                <td className="px-3 py-2 text-right num">{formatRupee(Number(r.taxable))}</td>
                <td className="px-3 py-2 text-right num">{Number(r.gst_pct)}%</td>
                <td className="px-3 py-2 text-right num font-semibold">{formatRupee(Number(r.total))}</td>
                <td className="px-3 py-2 text-right">
                  <Link href={`/app/general-purchases/${r.id}`} className="btn-ghost text-xs inline-flex items-center gap-1">
                    <Pencil className="w-3.5 h-3.5" /> Edit
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
