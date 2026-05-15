import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Outsource Weaving' };
export default function Page() {
  return (
    <div>
      <PageHeader title="Outsource Weaving" subtitle="Yarn issued to weaving vendors, fabric received back, vendor pick paise tracked per order." />
      <ComingSoon />
    </div>
  );
}
