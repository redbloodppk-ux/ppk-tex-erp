/**
 * New employee loan
 *
 * Server component shell — loads the active employee list and renders the
 * client form. The form INSERTs into employee_loan and records the cash
 * outflow on the chosen Cash/Bank ledger (source_ledger_id).
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { LoanForm, type EmployeeOption } from '../loan-form';

export const metadata = { title: 'Issue Loan' };
export const dynamic = 'force-dynamic';

export default async function NewLoanPage(): Promise<React.ReactElement> {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('employee')
    .select('id, code, full_name, role')
    .eq('status', 'active')
    .order('full_name');

  const employees = (data as unknown as EmployeeOption[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Issue Loan"
        crumbs={[{ label: 'Loans', href: '/app/loans' }, { label: 'New' }]}
      />
      <LoanForm employees={employees} />
    </div>
  );
}
