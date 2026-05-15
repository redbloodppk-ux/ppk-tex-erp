import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: company }, { data: users }] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).maybeSingle(),
    supabase.from('app_user').select('id, email, full_name, role, is_active').order('full_name'),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, users and roles, document sequences, system constants." />

      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Company</h2>
        {company ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-soft">Legal Name</dt><dd className="font-semibold">{(company as any).legal_name}</dd>
            <dt className="text-ink-soft">GSTIN</dt><dd className="num">{(company as any).gstin}</dd>
            <dt className="text-ink-soft">Address</dt><dd>{(company as any).address_line1}, {(company as any).city} {(company as any).pincode}</dd>
            <dt className="text-ink-soft">Phone</dt><dd className="num">{(company as any).contact_phone}</dd>
          </dl>
        ) : <p className="text-sm text-ink-soft">No company profile loaded yet.</p>}
      </div>

      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Users & Roles</h2>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
            <tr><th className="text-left py-2">Name</th><th className="text-left">Email</th><th className="text-left">Role</th><th className="text-right">Status</th></tr>
          </thead>
          <tbody>
            {users?.length ? users.map((u: any) => (
              <tr key={u.id} className="border-b border-line/40 last:border-0">
                <td className="py-2.5 font-semibold">{u.full_name}</td>
                <td className="text-xs text-ink-soft">{u.email}</td>
                <td className="text-xs uppercase">{u.role.replace(/_/g, ' ')}</td>
                <td className="text-right">
                  <span className={`pill ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                    {u.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="py-6 text-center text-ink-soft text-sm">No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
