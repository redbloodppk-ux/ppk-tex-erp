/**
 * Receive a loan repayment paid directly by the worker (migration 336).
 * Server shell: works out each employee's outstanding loan
 *   = loans given − wage deductions − direct repayments
 * and lists only employees who still owe something.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { RepayForm, type RepayEmployee } from './repay-form';
import { fetchAll } from '@/lib/supabase/fetch-all';

export const metadata = { title: 'Receive Loan Repayment' };
export const dynamic = 'force-dynamic';

export default async function RepayPage({ searchParams }: {
  searchParams: Promise<{ emp?: string }>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [{ data: emps }, { data: loans }, { data: direct }] = await Promise.all([
    sb.from('employee').select('id, code, full_name').order('full_name'),
    sb.from('employee_loan').select('employee_id, amount').limit(5000),
    sb.from('employee_loan_repayment').select('employee_id, amount').limit(5000),
  ]);
  const deds = await fetchAll<{ employee_id: number; loan_deduction: number | null }>((lo, hi) => sb
    .from('wage_entry').select('id, employee_id, loan_deduction').gt('loan_deduction', 0)
    .order('id', { ascending: true }).range(lo, hi));

  const bal = new Map<number, number>();
  for (const r of (loans ?? []) as Array<{ employee_id: number; amount: number }>) {
    bal.set(r.employee_id, (bal.get(r.employee_id) ?? 0) + Number(r.amount || 0));
  }
  for (const r of deds.rows) bal.set(r.employee_id, (bal.get(r.employee_id) ?? 0) - Number(r.loan_deduction || 0));
  for (const r of (direct ?? []) as Array<{ employee_id: number; amount: number }>) {
    bal.set(r.employee_id, (bal.get(r.employee_id) ?? 0) - Number(r.amount || 0));
  }

  const employees: RepayEmployee[] = ((emps ?? []) as Array<{ id: number; code: string; full_name: string }>)
    .map((e) => ({ ...e, outstanding: Math.round((bal.get(e.id) ?? 0) * 100) / 100 }))
    .filter((e) => e.outstanding > 0.005);

  const empId = sp.emp && /^\d+$/.test(sp.emp) ? Number(sp.emp) : null;

  return (
    <div>
      <PageHeader
        title="Receive Loan Repayment"
        subtitle="A worker paid their loan back directly in cash or to the bank."
        crumbs={[{ label: 'Loans', href: '/app/loans' }, { label: 'Receive repayment' }]}
      />
      <RepayForm employees={employees} defaultEmployeeId={empId} />
    </div>
  );
}
