import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Production' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Production" subtitle="Loom batches, daily production by shift, fabric stock build-up." />
      <ComingSoon />
    </div>
  );
}
