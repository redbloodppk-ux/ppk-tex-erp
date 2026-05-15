import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Job Work' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Job Work Received" subtitle="Customer-supplied yarn, weaving charges only — no yarn cost in invoice." />
      <ComingSoon />
    </div>
  );
}
