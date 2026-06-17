import { PageHeader } from '@/app/components/page-header';
import { SalesOrderForm } from './so-form';

export const metadata = { title: 'New Sales Order' };
export const dynamic = 'force-dynamic';

export default function NewSalesOrderPage() {
  return (
    <div>
      <PageHeader
        title="New Sales Order"
        subtitle="Confirm an order from a customer so it can be dispatched, invoiced, and tracked through to payment."
        crumbs={[
          { label: 'Sales Orders', href: '/app/orders' },
          { label: 'New' },
        ]}
      />
      <SalesOrderForm />
    </div>
  );
}
