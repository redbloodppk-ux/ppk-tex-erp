import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SalesOrderForm } from '../../new/so-form';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Edit Sales Order' };
export const dynamic = 'force-dynamic';

// Only orders that have not yet moved into production/dispatch may be edited
// — changing quantities after dispatch would corrupt delivery tracking.
const EDITABLE_STATUSES = new Set(['draft', 'pending_approval', 'approved']);

interface SoLineRow {
  fabric_quality_id: number | null;
  uom: 'm' | 'pcs' | null;
  quantity_m: number | string | null;
  pieces: number | string | null;
  rate_per_m: number | string | null;
}

function diffDays(from: string | null, to: string | null): string {
  if (!from || !to) return '';
  const a = new Date(from + 'T00:00:00');
  const b = new Date(to + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return '';
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return days > 0 ? String(days) : '';
}

export default async function EditSalesOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const soId = Number(id);
  if (!Number.isFinite(soId)) notFound();

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const { data: so } = await sb
    .from('sales_order')
    .select('id, so_number, customer_id, order_date, delivery_date, payment_date, status, notes')
    .eq('id', soId)
    .single();
  if (!so) notFound();

  if (!EDITABLE_STATUSES.has(so.status)) {
    return (
      <div>
        <PageHeader
          title={`Edit ${so.so_number}`}
          subtitle="This order can no longer be edited."
          crumbs={[{ label: 'Sales Orders', href: '/app/orders' }, { label: so.so_number }]}
        />
        <div className="card p-6 text-sm text-ink-mute">
          Order <span className="font-mono">{so.so_number}</span> is{' '}
          <span className="font-semibold">{so.status}</span> and has moved past the
          confirmed stage, so it can&apos;t be edited (that would break delivery and
          invoice tracking).{' '}
          <Link href="/app/orders" className="text-indigo-700 underline">
            Back to Sales Orders
          </Link>
        </div>
      </div>
    );
  }

  const { data: linesRaw } = await sb
    .from('sales_order_line')
    .select('fabric_quality_id, uom, quantity_m, pieces, rate_per_m')
    .eq('so_id', soId)
    .order('id');
  const lines = (linesRaw ?? []) as SoLineRow[];

  const initial = {
    customer_id: so.customer_id != null ? String(so.customer_id) : '',
    order_date: so.order_date ? String(so.order_date).slice(0, 10) : '',
    delivery_date: so.delivery_date ? String(so.delivery_date).slice(0, 10) : '',
    payment_days: diffDays(
      so.order_date ? String(so.order_date).slice(0, 10) : null,
      so.payment_date ? String(so.payment_date).slice(0, 10) : null,
    ),
    notes: so.notes ?? '',
    lines:
      lines.length > 0
        ? lines.map((l) => {
            const uom: 'm' | 'pcs' = l.uom === 'pcs' ? 'pcs' : 'm';
            // The quoted quantity differs by unit: a pcs line was entered as a
            // piece count, a metres line as metres.
            const quantity =
              uom === 'pcs' ? l.pieces : l.quantity_m;
            return {
              fabric_quality_id: l.fabric_quality_id != null ? String(l.fabric_quality_id) : '',
              uom,
              quantity: quantity != null ? String(quantity) : '',
              pieces: l.pieces != null ? String(l.pieces) : '',
              rate: l.rate_per_m != null ? String(l.rate_per_m) : '',
            };
          })
        : [{ fabric_quality_id: '', uom: 'm' as const, quantity: '', pieces: '', rate: '' }],
  };

  return (
    <div>
      <PageHeader
        title={`Edit ${so.so_number}`}
        subtitle="Update the customer, dates, or lines for this order."
        crumbs={[
          { label: 'Sales Orders', href: '/app/orders' },
          { label: so.so_number },
          { label: 'Edit' },
        ]}
      />
      <SalesOrderForm mode="edit" soId={soId} initial={initial} />
    </div>
  );
}
