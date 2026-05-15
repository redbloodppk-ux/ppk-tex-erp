import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Purchase Payments' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Purchase Payments" subtitle="Outgoing payments to mills and weaving vendors." />
      <ComingSoon />
    </div>
  );
}
