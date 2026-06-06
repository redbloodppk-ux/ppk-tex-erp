/**
 * Employees list (master)
 *
 * Server component. Lists every employee with status filter + role filter
 * driven by GET params. The attendance system reads from this table so this
 * is the single source of truth for who is on staff.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import Link from 'next/link';
import { Plus, Phone, Pencil } from 'lucide-react';

export const metadata = { title: 'Employees' };
export const dynamic = 'force-dynamic';

// Columns the operator can sort by — falls back to full_name otherwise.
const SORTABLE_COLUMNS = new Set(['code', 'full_name']);

const ROLE_OPTIONS = [
  'weaver', 'fitter', 'folder', 'winder', 'knotter', 'auto', 'office', 'other',
] as const;
type Role = (typeof ROLE_OPTIONS)[number];

const STATUS_OPTIONS = ['active', 'inactive', 'resigned'] as const;
type Status = (typeof STATUS_OPTIONS)[number];

interface EmployeeRow {
  id: number;
  code: string;
  full_name: string;
  role: Role;
  default_shift: 'morning' | 'night' | 'either';
  phone: string | null;
  date_of_joining: string | null;
  status: Status;
}

const STATUS_PILL: Record<Status, string> = {
  active:   'bg-emerald-50 text-emerald-700',
  inactive: 'bg-amber-50 text-amber-700',
  resigned: 'bg-slate-100 text-slate-500',
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string; status?: string; sort?: string; dir?: string }>;
}) {
  const sp = await searchParams;
  const role   = sp.role && ROLE_OPTIONS.includes(sp.role as Role) ? (sp.role as Role) : null;
  const status = sp.status && STATUS_OPTIONS.includes(sp.status as Status)
    ? (sp.status as Status)
    : 'active';
  const sort: string = SORTABLE_COLUMNS.has(sp.sort ?? '') ? (sp.sort as string) : 'full_name';
  const dir: SortDir = sp.dir === 'desc' ? 'desc' : 'asc';

  const supabase = await createClient();
  let query = supabase
    .from('employee')
    .select('id, code, full_name, role, default_shift, phone, date_of_joining, status')
    .order(sort, { ascending: dir === 'asc' });

  if (role)   query = query.eq('role', role as never);
  if (status) query = query.eq('status', status as never);

  const { data, error } = await query;
  const rows = (data as unknown as EmployeeRow[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle="Master list of staff used by attendance, wages, and shift logs."
        actions={
          <Link href="/app/employees/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Employee
          </Link>
        }
      />

      <form method="GET" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue={role ?? ''} className="input min-w-[140px]">
            <option value="">All roles</option>
            {ROLE_OPTIONS.map(r => (
              <option key={r} value={r} className="capitalize">{r}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="input min-w-[120px]">
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s} className="capitalize">{s}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary min-h-[40px]">Apply</button>
        <span className="text-xs text-ink-mute ml-1">
          {rows.length} {rows.length === 1 ? 'person' : 'people'}
        </span>
      </form>

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load employees: {error.message}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <SortableTh column="code" label="Code" sort={sort} dir={dir} basePath="/app/employees" extraParams={{ role: role ?? undefined, status }} className="text-left px-4 py-3" />
              <SortableTh column="full_name" label="Name" sort={sort} dir={dir} basePath="/app/employees" extraParams={{ role: role ?? undefined, status }} className="text-left px-4 py-3" />
              <th className="text-left px-4 py-3">Role</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Shift</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Phone</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Joined</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map(e => (
              <tr key={e.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 font-mono text-xs">{e.code}</td>
                <td className="px-4 py-3 font-medium">
                  <Link href={`/app/employees/${e.id}`} className="hover:text-indigo">
                    {e.full_name}
                  </Link>
                </td>
                <td className="px-4 py-3 capitalize text-xs">{e.role}</td>
                <td className="px-4 py-3 hidden md:table-cell capitalize text-xs">
                  {e.default_shift}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  {e.phone ? (
                    <span className="flex items-center gap-1.5">
                      <Phone className="w-3 h-3" /> {e.phone}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                  {e.date_of_joining ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={`pill ${STATUS_PILL[e.status]}`}>{e.status}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/app/employees/${e.id}`}
                    className="text-indigo text-xs inline-flex items-center gap-1 hover:underline"
                  >
                    <Pencil className="w-3 h-3" /> Edit
                  </Link>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No employees match this filter.{' '}
                  <Link href="/app/employees/new" className="text-indigo font-semibold">
                    Add one →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
