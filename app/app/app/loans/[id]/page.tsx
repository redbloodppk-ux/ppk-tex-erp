/**
 * Edit employee loan
 *
 * Server component shell — loads the existing employee_loan row + the full
 * employee list and renders the reusable LoanForm in edit mode.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import {
  LoanForm,
  type EmployeeOption,
  type InitialLoan,
} from '../loan-form';

export const metadata = { title: 'Edit Loan' };
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditLoanPage({ params }: PageProps): Promise<React.ReactElement> {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const supabase = await createClient();

  // employee_loan types lag the regen — cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (supabase as any)
    .from('employee_loan')
    .select('id, employee_id, loan_date, amount, notes, source_ledger_id')
    .eq('id', id)
    .maybeSingle();

  if (!row) notFound();

  // For edit we don't filter to active employees: the borrower may have been
  // deactivated since, but must still appear in the dropdown so the saved row
  // stays valid.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: emps } = await (supabase as any)
    .from('employee')
    .select('id, code, full_name, role')
    .order('full_name');

  const employees = (emps as unknown as EmployeeOption[]) ?? [];

  const initial = row as unknown as InitialLoan;

  return (
    <div>
      <PageHeader
        title="Edit Loan"
        crumbs={[{ label: 'Loans', href: '/app/loans' }, { label: `#${initial.id}` }]}
      />
      <LoanForm employees={employees} initial={initial} />
    </div>
  );
}
