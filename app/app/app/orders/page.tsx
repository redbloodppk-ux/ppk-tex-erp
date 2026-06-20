import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatRupee, formatDate } from '@/lib/utils';
import { SoRowActions } from './so-row-actions';
// DcConfirmButton import removed — the DC inbox was lifted off this page.

export const metadata = { title: 'Sales Orders' };
export const dynamic = 'force-dynamic';

// Whitelisted sort keys on the sales_order list.
const SORTABLE_COLUMNS = new Set(['so_number', 'order_date']);

type SoStatus =
  | 'draft' | 'pending_approval' | 'approved' | 'in_production'
  | 'partial_dispatch' | 'dispatched' | 'invoiced' | 'paid' | 'closed' | 'cancelled';

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
  closed:            { label: 'Closed',           cls: 'bg-slate-200 text-slate-700' },
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

  // (Pending Delivery Challan inbox removed per operator — they manage
  // DCs from /app/delivery-challan now. The query is no longer run.)

  // Per-SO delivery progress (ordered vs delivered metres) so the list
  // can show a Balance column + a clearer Partial / Dispatched picture.
  const soIds = orders.map((o) => o.id);
  const orderedById = new Map<number, number>();         // ordered metres
  const orderedPcsById = new Map<number, number>();      // ordered pieces
  const nonPcsLineById = new Map<number, boolean>();      // has any metres line?
  const deliveredById = new Map<number, number>();        // delivered metres
  if (soIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [{ data: linesData }, { data: dcLinks }] = await Promise.all([
      sb.from('sales_order_line').select('so_id, quantity_m, pieces, uom').in('so_id', soIds),
      sb.from('delivery_challan').select('id, sales_order_id, status')
        .in('sales_order_id', soIds).not('status', 'eq', 'cancelled'),
    ]);
    for (const l of (linesData ?? []) as Array<{ so_id: number; quantity_m: number | string | null; pieces: number | string | null; uom: string | null }>) {
      orderedById.set(l.so_id, (orderedById.get(l.so_id) ?? 0) + Number(l.quantity_m ?? 0));
      orderedPcsById.set(l.so_id, (orderedPcsById.get(l.so_id) ?? 0) + Number(l.pieces ?? 0));
      if (l.uom !== 'pcs') nonPcsLineById.set(l.so_id, true);
    }
    const linkedDcIds = ((dcLinks ?? []) as Array<{ id: number; sales_order_id: number }>);
    if (linkedDcIds.length > 0) {
      const dcIdSet = linkedDcIds.map((d) => d.id);
      const { data: items } = await sb.from('delivery_challan_item')
        .select('dc_id, metres, fabric_quality:fabric_quality_id ( meter_per_pc )').in('dc_id', dcIdSet);
      const soByDc = new Map(linkedDcIds.map((d) => [d.id, d.sales_order_id]));
      for (const it of (items ?? []) as Array<{ dc_id: number; metres: number | string | null; fabric_quality: { meter_per_pc: number | string | null } | null }>) {
        const soId = soByDc.get(it.dc_id);
        if (soId == null) continue;
        // Towels (meter_per_pc > 0) store the towel COUNT in `metres`, not real
        // metres. Convert to real metres (count × meter_per_pc) so the pcs↔m
        // ratio below reconverts it correctly. Plain fabric uses metres as-is.
        const mpp = Number(it.fabric_quality?.meter_per_pc ?? 0);
        const realM = mpp > 0 ? Number(it.metres ?? 0) * mpp : Number(it.metres ?? 0);
        deliveredById.set(soId, (deliveredById.get(soId) ?? 0) + realM);
      }
    }
  }

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

      {/* Delivery Challan inbox and the placeholder ComingSoon empty
          state were removed at the operator's request — the Sales
          Orders list page now shows ONLY the Sales Orders table. DCs
          are managed from /app/delivery-challan. */}

      {orders.length === 0 ? (
        <div className="card p-6 text-sm text-ink-mute text-center">
          No sales orders yet. Click <span className="font-semibold">New Sales Order</span> to capture your first one — it will appear here with its delivery date, status, and total.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <SortableTh column="so_number" label="SO No" sort={sort} dir={dir} basePath="/app/orders" className="text-left px-4 py-3" />
                <th className="text-left px-4 py-3">Customer</th>
                <SortableTh column="order_date" label="Order Date" sort={sort} dir={dir} basePath="/app/orders" className="text-left px-4 py-3" />
                <th className="text-left px-4 py-3 hidden md:table-cell">Delivery</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Ordered</th>
                <th className="text-right px-4 py-3 hidden sm:table-cell">Delivered</th>
                <th className="text-right px-4 py-3">Balance</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-right px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const meta = STATUS_META[o.status] ?? { label: o.status, cls: 'bg-slate-100 text-slate-600' };
                const orderedM = orderedById.get(o.id) ?? 0;
                const orderedPcs = orderedPcsById.get(o.id) ?? 0;
                const deliveredM = deliveredById.get(o.id) ?? 0;
                // An order is shown in pieces only when every one of its lines
                // was quoted in pieces. Delivery is tracked in metres, so we
                // convert it back to pieces using this order's own pcs↔m ratio.
                const isPcs = orderedPcs > 0 && !nonPcsLineById.get(o.id);
                const unit = isPcs ? 'pcs' : 'm';
                const ordered = isPcs ? orderedPcs : orderedM;
                const delivered = isPcs
                  ? (orderedM > 0 ? deliveredM * (orderedPcs / orderedM) : 0)
                  : deliveredM;
                const balance = Math.max(ordered - delivered, 0);
                const fmtQty = (n: number) =>
                  n > 0 ? `${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${unit}` : '-';
                return (
                  <tr key={o.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-4 py-3 font-mono text-xs">{o.so_number}</td>
                    <td className="px-4 py-3 font-semibold">
                      {o.customer_id != null ? (customerNameById.get(o.customer_id) ?? '-') : '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-soft">{formatDate(o.order_date)}</td>
                    <td className="px-4 py-3 text-xs text-ink-soft hidden md:table-cell">{formatDate(o.delivery_date)}</td>
                    <td className="px-4 py-3 text-right num text-xs hidden sm:table-cell">{fmtQty(ordered)}</td>
                    <td className="px-4 py-3 text-right num text-xs hidden sm:table-cell text-emerald-700">{fmtQty(delivered)}</td>
                    <td className={`px-4 py-3 text-right num text-xs font-semibold ${balance > 0 ? 'text-rose-700' : 'text-ink-mute'}`}>{fmtQty(balance)}</td>
                    <td className="px-4 py-3 text-right num font-semibold">{formatRupee(o.total ?? 0, { compact: true })}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className={`pill ${meta.cls} text-xs uppercase tracking-wide`}>{meta.label}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <SoRowActions soId={o.id} soNumber={o.so_number} status={o.status} />
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
