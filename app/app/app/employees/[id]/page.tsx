/**
 * Edit employee.
 *
 * Loads the row by id and hydrates the shared EmployeeForm. Returns 404 if
 * the id is missing or the row was deleted.
 */
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { EmployeeForm, type EmployeeFormValues } from '../employee-form';

export const metadata = { title: 'Edit Employee' };
export const dynamic = 'force-dynamic';

interface EmployeeRow {
  id: number;
  code: string;
  full_name: string;
  role: string;
  default_shift: string;
  date_of_joining: string | null;
  phone: string | null;
  id_last4: string | null;
  status: string;
  notes: string | null;
  attendance_required: boolean | null;
  wage_alloc_basis: 'metres' | 'loom_shifts' | 'weekly' | null;
  weekly_salary: number | string | null;
}

export default async function EditEmployeePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) notFound();

  const supabase = await createClient();
  // weekly_salary added in migration 037 — supabase-js types lag, cast through any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('employee')
    .select('id, code, full_name, role, default_shift, date_of_joining, phone, id_last4, status, notes, attendance_required, wage_alloc_basis, weekly_salary')
    .eq('id', numericId)
    .maybeSingle();

  const emp = data as unknown as EmployeeRow | null;
  if (!emp) notFound();

  const initial: EmployeeFormValues = {
    code:            emp.code,
    full_name:       emp.full_name,
    role:            emp.role,
    default_shift:   emp.default_shift,
    date_of_joining: emp.date_of_joining ?? '',
    phone:           emp.phone ?? '',
    id_last4:        emp.id_last4 ?? '',
    status:          emp.status,
    notes:           emp.notes ?? '',
    // attendance_required defaults to true for legacy rows where the column
    // was just added (migration 030).
    attendance_required: emp.attendance_required ?? true,
    wage_alloc_basis:    emp.wage_alloc_basis ?? 'weekly',
    weekly_salary:       emp.weekly_salary == null ? '' : String(emp.weekly_salary),
  };

  return (
    <div>
      <PageHeader
        title={emp.full_name}
        subtitle={`${emp.code} — edit master details`}
        crumbs={[
          { label: 'Employees', href: '/app/employees' },
          { label: emp.full_name },
        ]}
      />
      <EmployeeForm initial={initial} employeeId={emp.id} />
    </div>
  );
}
