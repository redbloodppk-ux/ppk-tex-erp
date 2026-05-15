import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Resale' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Fabric Resale" subtitle="Fabric purchased ready and resold without weaving — purchase + selling price tracked per lot." />
      <ComingSoon />
    </div>
  );
}
