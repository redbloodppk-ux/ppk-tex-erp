/** Employee Weekly Wages report — see view.tsx. */
import { EmployeeWeeklyWagesView, type WeeklyWagesParams } from './view';

export const metadata = { title: 'Employee Weekly Wages' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<WeeklyWagesParams> }) {
  return <EmployeeWeeklyWagesView sp={await searchParams} />;
}
