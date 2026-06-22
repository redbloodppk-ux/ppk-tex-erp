/**
 * Edit wage entry  (CORR-T4)
 *
 * Server component shell — loads the active employee list + the existing
 * wage_entry row and renders the reusable WageEntryForm in edit mode.
 * On Save the form does an UPDATE; on Delete the list page does it.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  WageEntryForm,
  type EmployeeOption,
  type InitialEntry,
} from '../new/wage-entry-form';

export const metadata = { title: 'Edit Wage Entry' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditWagePage({ params }: PageProps): Promise<React.ReactElement> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const supabase = await createClient();

  // wage_entry types lag the regen — cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('wage_entry')
    .select('id, employee_id, pay_date, period_start, period_end, kind, amount, notes, source_ledger_id')
    .eq('id', id)
    .maybeSingle();

  if (!row) notFound();

  // For edit we don't filter to active employees: the originally-paid employee
  // may have been deactivated since, but they must still appear in the
  // dropdown so the saved row stays valid.
  // weekly_salary added in migration 037 — supabase-js types lag, cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: emps } = await (supabase as any)
    .from('employee')
    .select('id, code, full_name, role, wage_alloc_basis, attendance_required, weekly_salary')
    .order('full_name');

  const employees = (emps as unknown as EmployeeOption[]) ?? [];

  const initial = row as unknown as InitialEntry;

  return (
    <div>
      <PageHeader
        title="Edit Wage Entry"
        crumbs={[{ label: 'Wages', href: '/app/wages' }, { label: `#${initial.id}` }]}
      />
      <WageEntryForm employees={employees} initial={initial} />
    </div>
  );
}
