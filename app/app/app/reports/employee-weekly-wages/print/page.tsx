/** Print / PDF view of the Employee Weekly Wages report (same filters). */
import { EmployeeWeeklyWagesView, type WeeklyWagesParams } from '../view';

export const metadata = { title: 'Employee Weekly Wages — Print' };
export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<WeeklyWagesParams> }) {
  return <EmployeeWeeklyWagesView sp={await searchParams} print />;
}
