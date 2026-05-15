import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Stale Alerts' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Stale Alerts" subtitle="Orders with no movement for 7+ days, vendors with no fabric received in 14+ days, etc." />
      <ComingSoon />
    </div>
  );
}
