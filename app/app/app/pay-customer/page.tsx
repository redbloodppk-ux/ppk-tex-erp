import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Customer Payments' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Customer Payments" subtitle="Record incoming receipts. Allocates to outstanding invoices oldest-first." />
      <ComingSoon />
    </div>
  );
}
