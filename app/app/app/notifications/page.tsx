import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Notifications' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Notifications" subtitle="System alerts: low yarn, overdue invoices, costing approvals pending." />
      <ComingSoon />
    </div>
  );
}
