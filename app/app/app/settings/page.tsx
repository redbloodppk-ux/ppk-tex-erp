import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ChevronRight, Settings2, Factory } from 'lucide-react';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const [{ data: company }, { data: users }, { data: overhead }] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).maybeSingle(),
    supabase.from('app_user').select('id, email, full_name, role, is_active').order('full_name'),
    supabase.from('v_looms_overhead').select('total_per_m').maybeSingle(),
  ]);
  const overheadTotal = (overhead as { total_per_m: number | null } | null)?.total_per_m;

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Company profile, users and roles, document sequences, system constants." />

      {/* Mill setup */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Mill setup</h2>
        <Link
          href="/app/settings/looms"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Factory className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Looms</div>
              <div className="text-xs text-ink-soft">
                Add looms, set status and width, and assign each loom to a weaving shed (1-4).
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
      </div>

      {/* Calibration shortcuts (Build Guide T-B12) */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Calibration</h2>
        <Link
          href="/app/settings/looms-calibration"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Settings2 className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">LOOMS Calibration</div>
              <div className="text-xs text-ink-soft">
                Per-metre overhead used in True Cost for in-house fabric (power, labour, maintenance,
                depreciation, insurance).
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm">
            {overheadTotal != null && (
              <span className="num font-bold text-indigo-700">
                {`\u20B9${Number(overheadTotal).toFixed(2)}/m`}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-ink-mute" />
          </div>
        </Link>
      </div>

      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Company</h2>
        {company ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-soft">Legal Name</dt>
            <dd className="font-semibold">{(company as any).legal_name}</dd>
            <dt className="text-ink-soft">GSTIN</dt>
            <dd className="num">{(company as any).gstin}</dd>
            <dt className="text-ink-soft">Address</dt>
            <dd>{(company as any).address_line1}, {(company as any).city} {(company as any).pincode}</dd>
            <dt className="text-ink-soft">Phone</dt>
            <dd className="num">{(company as any).contact_phone}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-soft">No company profile loaded yet.</p>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Users & Roles</h2>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left">Email</th>
              <th className="text-left">Role</th>
              <th className="text-right">Status</th>
            </tr>
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
