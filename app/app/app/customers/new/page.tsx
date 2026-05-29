'use client';
import { PageHeader } from '@/app/components/page-header';
import { CustomerForm } from '../customer-form';

export default function NewCustomerPage() {
  return (
    <div className="max-w-2xl">
      <PageHeader
        title="New Customer"
        crumbs={[{ label: 'Customers', href: '/app/customers' }, { label: 'New' }]}
      />
      <CustomerForm />
    </div>
  );
}
