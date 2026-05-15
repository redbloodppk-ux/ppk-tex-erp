import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { formatRupee, formatDate, formatMetres } from '@/lib/utils';

export const metadata = { title: 'Sales Orders' };

export default async function OrdersPage() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from('sales_order')
    .select('id, doc_no, customer_name, order_date, expected_delivery_date, total_metres, total_amount, status')
    .order('order_date', { ascending: false })
    .limit(50);

  return (
    <div>
      <PageHeader
        title="Sales Orders"
        subtitle="Track every customer purchase order from creation to invoicing."
        actions={
          <Link href="/app/orders/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New SO
          </Link>
        }
      />
      {!orders?.length ? (
        <ComingSoon note="No sales orders yet. Once you create one, it appears here with delivery date and invoiced status." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-3">Doc No</th>
                <th className="text-left px-4 py-3">Customer</th>
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
