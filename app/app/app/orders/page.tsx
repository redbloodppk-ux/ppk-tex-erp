import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import Link from 'next/link';
import { Plus, Pencil, FileText } from 'lucide-react';
import { formatRupee, formatDate, formatMetres } from '@/lib/utils';
import { DcConfirmButton } from './dc-confirm-button';

export const metadata = { title: 'Sales Orders' };
export const dynamic = 'force-dynamic';

// Whitelisted sort keys on the sales_order list.
const SORTABLE_COLUMNS = new Set(['doc_no', 'customer_name']);

interface PendingDc {
  id: number;
  code: string;
  dc_date: string;
  production_mode: 'inhouse' | 'jobwork';
  bill_to_name: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'order_date';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : sp.dir === 'asc' ? 'asc' : 'desc';

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from('sales_order')
    .select('id, doc_no, customer_name, order_date, expected_delivery_date, total_metres, total_amount, status')
    .order(sort, { ascending: dir === 'asc' })
    .limit(50);

  // Draft DCs that are waiting for the operator to confirm before they
  // can be turned into invoices.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingDcs } = await (supabase as any)
    .from('delivery_challan')
    .select('id, code, dc_date, production_mode, bill_to_name, total_metres, total_pieces, total_bundles, status')
    .in('status', ['draft', 'confirmed'])
    .is('invoice_id', null)
    .order('dc_date', { ascending: false })
    .limit(50);
  const pending = (pendingDcs ?? []) as PendingDc[];

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        subtitle="Track every customer purchase order from creation to invoicing."
        actions={
          <Link href="/app/delivery-challan/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New DC
          </Link>
        }
      />

      {/* DELIVERY CHALLAN INBOX
          DCs created from /app/delivery-challan land here for the sales
          team to confirm before invoicing. Confirmed DCs stay visible
          until an invoice is generated, then drop off the inbox. */}
      {pending.length > 0 && (
        <div className="card mb-5 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-line/60 bg-amber-50/50">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-amber-700" />
              <h2 className="font-display font-bold text-sm">Delivery Challans awaiting action</h2>
              <span className="pill bg-amber-100 text-amber-700 text-[10px]">{pending.length}</span>
            </div>
            <Link href="/app/delivery-challan" className="text-xs text-indigo hover:underline">
              Manage all DCs →
            </Link>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-2.5">DC No</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-left px-4 py-2.5">Mode</th>
                <th className="text-left px-4 py-2.5">Party</th>
                <th className="text-right px-4 py-2.5">Metres</th>
                <th className="text-right px-4 py-2.5">Pcs</th>
                <th className="text-right px-4 py-2.5">Bundles</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-right px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {pending.map((d) => (
                <tr key={d.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/app/delivery-challan/${d.id}`} className="text-indigo hover:underline">{d.code}</Link>
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{formatDate(d.dc_date)}</td>
                  <td className="px-4 py-2 text-xs capitalize">{d.production_mode}</td>
                  <td className="px-4 py-2 font-medium">{d.bill_to_name ?? '-'}</td>
                  <td className="px-4 py-2 text-right num">{Number(d.total_metres ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</td>
                  <td className="px-4 py-2 text-right num">{d.total_pieces ?? 0}</td>
                  <td className="px-4 py-2 text-right num">{d.total_bundles ?? 0}</td>
                  <td className="px-4 py-2">
                    <span className={'pill text-xs uppercase tracking-wide ' +
                      (d.status === 'confirmed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-600')}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <Link href={`/app/delivery-challan/${d.id}`}
                      className="inline-flex items-center gap-1 p-1 rounded hover:bg-indigo-50 text-indigo-700 mr-1"
                      title="Edit DC">
                      <Pencil className="w-3.5 h-3.5" />
                    </Link>
                    {d.status === 'draft' && d.production_mode === 'inhouse' && (
                      <DcConfirmButton dcId={d.id} dcCode={d.code} />
                    )}
                    {d.status === 'draft' && d.production_mode === 'jobwork' && (
                      <span
                        className="pill bg-amber-50 text-amber-700 text-[10px] uppercase tracking-wide"
                        title="Auto-confirms when fabric is received"
                      >
                        Awaits fabric receipt
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!orders?.length ? (
        <ComingSoon note="No sales orders yet. Once you create one, it appears here with delivery date and invoiced status." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <SortableTh column="doc_no" label="Doc No" sort={sort} dir={dir} basePath="/app/orders" className="text-left px-4 py-3" />
                <SortableTh column="customer_name" label="Customer" sort={sort} dir={dir} basePath="/app/orders" className="text-left px-4 py-3" />
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Delivery</th>
                <th className="text-right px-4 py-3 hidden lg:table-cell">Metres</th>
                <th className="text-right px-4 py-3">Amount</th>
                <th className="text-right px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs">{o.doc_no}</td>
                  <td className="px-4 py-3 font-semibold">{o.customer_name}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{formatDate(o.order_date)}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft hidden md:table-cell">{formatDate(o.expected_delivery_date)}</td>
                  <td className="px-4 py-3 text-right num hidden lg:table-cell">{formatMetres(o.total_metres)}</td>
                  <td className="px-4 py-3 text-right num font-semibold">{formatRupee(o.total_amount, { compact: true })}</td>
                  <td className="px-4 py-3 text-right text-xs"><span className="pill bg-indigo-50 text-indigo-700">{o.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
