import { PageHeader, ComingSoon } from '@/app/components/page-header';
export const metadata = { title: 'Attendance' };
export default function Page() {
  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle="Mark Morning (8AM–8PM) and Night (8PM–8AM) shift attendance. Five statuses: present, absent, half-day, late, early leave."
      />
      <ComingSoon />
    </div>
  );
}
