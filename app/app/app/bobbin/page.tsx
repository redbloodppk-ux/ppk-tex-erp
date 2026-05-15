import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Bobbin Stock' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Bobbin Stock" subtitle="Bobbins (small warp beams) tracked across main godown / at vendor / customer-owned." />
      <ComingSoon />
    </div>
  );
}
