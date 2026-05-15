import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Wages' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Wages" subtitle="Weekly wage register — manual amount entry per employee, not auto-derived from attendance in v1." />
      <ComingSoon />
    </div>
  );
}
