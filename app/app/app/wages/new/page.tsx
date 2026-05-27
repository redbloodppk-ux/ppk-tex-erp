/**
 * New wage entry  (CORR-T4)
 *
 * Server component shell — loads the active employee list and renders the
 * client form. The form INSERTs into wage_entry; that immediately flows into
 * v_batch_wage_allocation so any in-house batch whose window overlaps this
 * period picks up its pro-rata share.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { WageEntryForm, type EmployeeOption } from './wage-entry-form';

export const metadata = { title: 'New Wage Entry' };
export const dynamic = 'force-dynamic';

export default async function NewWagePage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('employee')
    .select('id, code, full_name, role, wage_alloc_basis, attendance_required')
    .eq('status', 'active')
    .order('full_name');

  const employees = (data as unknown as EmployeeOption[]) ?? [];

  return (
    <div>
      <PageHeader
        title="New Wage Entry"
        crumbs={[{ label: 'Wages', href: '/app/wages' }, { label: 'New' }]}
      />
      <WageEntryForm employees={employees} 