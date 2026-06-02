/**
 * New employee page.
 *
 * Server component that suggests the next EMP-XXXX code by scanning the
 * highest existing one. The user can override before saving (the underlying
 * column is just a unique text — no trigger).
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { EmployeeForm, type EmployeeFormValues } from '../employee-form';

export const metadata = { title: 'New Employee' };
export const dynamic = 'force-dynamic';

async function nextEmployeeCode(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('employee')
    .select('code')
    .ilike('code', 'EMP-%')
    .order('code', { ascending: false })
    .limit(1);

  const lastCode = (data as { code: string }[] | null)?.[0]?.code;
  if (!lastCode) return 'EMP-0001';

  const m = lastCode.match(/^EMP-(\d+)$/);
  if (!m || !m[1]) return 'EMP-0001';
  const n = parseInt(m[1], 10) + 1;
  return `EMP-${String(n).padStart(4, '0')}`;
}

export default async function NewEmployeePage() {
  const code = await nextEmployeeCode();

  const initial: EmployeeFormValues = {
    code,
    full_name:       '',
    role:            'weaver',
    default_shift:   'morning',
    date_of_joining: '',
    phone:           '',
    id_last4:        '',
    status:          'active',
    notes:           '',
    attendance_required: true,
    wage_alloc_basis: 'weekly',
    weekly_salary: '',
    home_shed_no: '',
    default_sheds: [],
  };

  return (
    <div>
      <PageHeader
        title="New Employee"
        crumbs={[{ label: 'Employees', href: '/app/employees' }, { label: 'New' }]}
      />
      <EmployeeForm initial={initial} />
    </div>
  );
}
