/**
 * Settings → Users & Roles list.
 *
 * Owner-only. Lists every app_user row (active and archived) so the
 * owner can edit roles / status, archive someone who's left, or invite
 * a fresh teammate.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { requireOwner, NotOwnerError } from '@/lib/auth/require-owner';
import { Pencil, Plus, ShieldAlert, UserCheck, UserX } from 'lucide-react';

export const metadata = { title: 'Settings → Users & Roles' };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  mill_manager: 'Mill Manager',
  sales_manager: 'Sales Manager',
  accounts: 'Accounts',
  floor_operator: 'Floor Operator',
  auditor: 'Auditor',
};

interface AppUserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: string;
  status: string;
  last_login: string | null;
  created_at: string;
}

function statusPill(s: string): { label: string; cls: string } {
  switch (s) {
    case 'active':   return { label: 'Active',   cls: 'bg-emerald-50 text-emerald-700' };
    case 'inactive': return { label: 'Inactive', cls: 'bg-slate-100 text-slate-600' };
    case 'resigned': return { label: 'Resigned', cls: 'bg-amber-50 text-amber-700' };
    default:         return { label: s,          cls: 'bg-slate-100 text-slate-600' };
  }
}

function rolePill(role: string): string {
  if (role === 'owner')         return 'bg-violet-50 text-violet-700 border-violet-200';
  if (role === 'mill_manager')  return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (role === 'sales_manager') return 'bg-blue-50 text-blue-700 border-blue-200';
  if (role === 'accounts')      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (role === 'auditor')       return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default async function UsersAndRolesPage() {
  const supabase = await createClient();

  // Owner-only gate. Anyone else gets bounced back to the Settings
  // landing page; we surface the reason via a query param so the page
  // can show a small banner.
  try {
    await requireOwner(supabase);
  } catch (e) {
    if (e instanceof NotOwnerError) redirect('/app/settings?notice=owner-only');
    throw e;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data, error } = await sb
    .from('app_user')
    .select('id, email, full_name, phone, role, status, last_login, created_at')
    .order('status', { ascending: true })           // active first
    .order('full_name', { ascending: true });
  const rows = (data ?? []) as AppUserRow[];

  // KPI counts
  const counts = rows.reduce(
    (acc, r) => {
      acc.total += 1;
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      acc.byRole[r.role] = (acc.byRole[r.role] ?? 0) + 1;
      return acc;
    },
    { total: 0, byRole: {} as Record<string, number> } as Record<string, number> & { byRole: Record<string, number> },
  );

  return (
    <div>
      <PageHeader
        title="Users & Roles"
        subtitle="Add teammates, change roles, archive people who've left. All access is role-gated; only owners see this page."
        crumbs={[{ label: 'Settings', href: '/app/settings' }, { label: 'Users & Roles' }]}
        actions={
          <Link href="/app/settings/users/new" className="btn-primary">
            <Plus className="w-4 h-4" /> Invite user
          </Link>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total users</div>
          <div className="num text-xl font-bold">{counts.total}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute flex items-center gap-1">
            <UserCheck className="w-3 h-3 text-emerald-600" /> Active
          </div>
          <div className="num text-xl font-bold text-emerald-700">{counts.active ?? 0}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute flex items-center gap-1">
            <UserX className="w-3 h-3 text-slate-500" /> Inactive
          </div>
          <div className="num text-xl font-bold text-slate-600">{counts.inactive ?? 0}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute flex items-center gap-1">
            <ShieldAlert className="w-3 h-3 text-violet-600" /> Owners
          </div>
          <div className="num text-xl font-bold text-violet-700">{counts.byRole.owner ?? 0}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">
          Could not load users: {error.message}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left px-3 py-3">Name</th>
              <th className="text-left px-3 py-3">Email</th>
              <th className="text-left px-3 py-3">Phone</th>
              <th className="text-left px-3 py-3">Role</th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="text-left px-3 py-3">Last login</th>
              <th className="text-right px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-ink-soft">
                  No teammates yet.{' '}
                  <Link href="/app/settings/users/new" className="text-indigo-700 font-semibold underline">
                    Invite the first user &rarr;
                  </Link>
                </td>
              </tr>
            ) : rows.map((r) => {
              const sp = statusPill(r.status);
              return (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 font-semibold">{r.full_name}</td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{r.email}</td>
                  <td className="px-3 py-2 text-xs num">{r.phone ?? '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded border ${rolePill(r.role)} text-[11px] font-semibold uppercase tracking-wide`}>
                      {ROLE_LABEL[r.role] ?? r.role}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`pill ${sp.cls} text-xs uppercase tracking-wide`}>{sp.label}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{fmtDate(r.last_login)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/app/settings/users/${r.id}`}
                      className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex"
                      title="Edit user"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-mute mt-4">
        Invitations are sent via Supabase Auth as a magic link / OTP email. The user signs in with the link; no password is set.
        Owners can change roles and status; archived users keep their audit trail but lose sign-in access on next sign-out.
      </p>
    </div>
  );
}
