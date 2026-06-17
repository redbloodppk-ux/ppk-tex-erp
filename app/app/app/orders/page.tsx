import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import Link from 'next/link';
import { Plus, Pencil, FileText } from 'lucide-react';
import { formatRupee, formatDate } from '@/lib/utils';
import { DcConfirmButton } from './dc-confirm-button';

export const metadata = { title: 'Sales Orders' };
export const dynamic = 'force-dynamic';

// Whitelisted sort keys on the sales_order list.
const SORTABLE_COLUMNS = new Set(['so_number', 'order_date']);

interface PendingDc {
  id: number;
  code: string;
  dc_date: string;
  production_mode: 'inhouse' | 'jobwork' | 'outsource';
  bill_to_name: string | null;
  total_metres: number | string | null;
  total_pieces: number | null;
  total_bundles: number | null;
  status: 'draft' | 'confirmed' | 'invoiced' | 'cancelled';
}

type SoStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'in_production'
  | 'partial_dispatch' | 'dispatched' | 'invoiced' | 'paid' | 'cancelled';

interface SoRow {
  id: number;
  so_number: string;
  customer_id: number | null;
  order_date: string;
  delivery_date: string | null;
  total: number | string | null;
  status: SoStatus;
}

/** Friendly label + colour for each status. The trigger in migration
 *  193 walks the SO through approved -> dispatched -> invoiced -> paid;
 *  this map covers every value the enum can hold so the pill never
 *  reads "undefined". */
const STATUS_META: Record<SoStatus, { label: string; cls: string }> = {
  draft:             { label: 'Draft',            cls: 'bg-slate-100 text-slate-600' },
  pending_approval:  { label: 'Pending Approval', cls: 'bg-amber-50 text-amber-700' },
  approved:          { label: 'Confirmed',        cls: 'bg-indigo-50 text-indigo-700' },
  in_production:     { label: 'In Production',    cls: 'bg-sky-50 text-sky-700' },
  partial_dispatch:  { label: 'Partial Dispatch', cls: 'bg-amber-50 text-amber-700' },
  dispatched:        { label: 'Dispatched',       cls: 'bg-emerald-50 text-emerald-700' },
  invoiced:          { label: 'Invoiced',         cls: 'bg-emerald-50 text-emerald-700' },
  paid:              { label: 'Paid',             cls: 'bg-emerald-100 text-emerald-800' },
  cancelled:         { label: 'Cancelled',        cls: 'bg-rose-50 text-rose-700' },
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'order_date';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : sp.dir === 'asc' ? 'asc' : 'desc';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ordersRaw } = await (supabase as any)
    .from('sales_order')
    .select('id, so_number, customer_id, order_date, delivery_date, total, status')
    .order(sort, { ascending: dir === 'asc' })
    .limit(50);
  const orders = (ordersRaw ?? []) as SoRow[];

  // Pull customer names for the SOs in one shot rather than joining in
  // Supabase (the `customer` FK isn't always present in the generated
  // types, so a separate query is the least friction).
  const customerIds = Array.from(new Set(orders.map((o) => o.customer_id).filter((id): id is number => id != null)));
  let customerNameById = new Map<number, string>();
  if (customerIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: cust } = await (supabase as any)
      .from('customer')
      .select('id, name')
      .in('id', customerIds);
    customerNameById = new Map((cust ?? []).map((c: { id: number; name: string }) => [c.id, c.name]));
  }

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
          <Link href="/app/orders/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Sales Order
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

      {orders.length === 0 ? (
        <ComingSoon note="No sales orders yet. Click New Sales Order to capture your first one — it will appear here with its delivery date, status, and total." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <SortableTh column="so_number" label="SO No" sort={sort} dir={dir} basePath="/app/orders" className="text-left px-4 py-3" />
                <th className="text-left px-4 py-3">Customer</th>
                <SortableTh column="order_date" label="Order Date" sort={sort} dir={dir} basePath="/app/orders" className="text-left px-4 py-3" />
                <th className="text-left px-4 py-3 hidden md:table-cell">Delivery</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const meta = STATUS_META[o.status] ?? { label: o.status, cls: 'bg-slate-100 text-slate-600' };
                return (
                  <tr key={o.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-4 py-3 font-mono text-xs">{o.so_number}</td>
                    <td className="px-4 py-3 font-semibold">
                      {o.customer_id != null ? (customerNameById.get(o.customer_id) ?? '-') : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{formatDate(o.order_date)}</td>
                    <td className="px-4 py-3 text-xs text-ink-soft hidden md:table-cell">{formatDate(o.delivery_date)}</td>
                    <td className="px-4 py-3 text-right num font-semibold">{formatRupee(o.total ?? 0, { compact: true })}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className={`pill ${meta.cls} text-xs uppercase tracking-wide`}>{meta.label}</span>
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
