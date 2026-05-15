import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Reports' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Sales register, stock report, customer ageing, profit by quality." />
      <ComingSoon />
    </div>
  );
}
