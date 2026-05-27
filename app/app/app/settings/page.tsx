import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ChevronRight, Settings2, Factory, Wallet } from 'lucide-react';
import { NightShiftToggle } from './night-shift-toggle';
import { CostingDefaults } from './costing-defaults';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const [
    { data: company },
    { data: users },
    { data: overhead },
    { data: nightCfg },
    { data: yarnCfg },
    { data: porvaiCfg },
    { data: me },
  ] = await Promise.all([
    supabase.from('company_profile').select('*').limit(1).maybeSingle(),
    supabase.from('app_user').select('id, email, full_name, role, is_active').order('full_name'),
    supabase.from('v_looms_overhead').select('total_per_m').maybeSingle(),
    supabase.from('system_config').select('value').eq('key', 'shift_log_night_enabled').maybeSingle(),
    supabase.from('system_config').select('value').eq('key', 'default_yarn_wastage_pct').maybeSingle(),
    supabase.from('system_config').select('value').eq('key', 'default_porvai_wastage_pct').maybeSingle(),
    user
      ? supabase.from('app_user').select('role').eq('id', user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const overheadTotal = (overhead as { total_per_m: number | null } | null)?.total_per_m;
  const nightEnabled = Boolean(
    (nightCfg as { value: { enabled?: boolean } | null } | null)?.value?.enabled,
  );
  // system_config.value is JSONB — these two keys store a bare JSON number (0.02 = 2%).
  const yarnPct = Number((yarnCfg as { value: unknown } | null)?.value ?? 0.02);
  const porvaiPct = Number((porvaiCfg as { value: unknown } | null)?.value ?? 0.02);
  const role = (me as { role: string } | null)?.role;
  const canEditNight = role === 'owner';
  const canEditCosting = role === 'owner';

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

      {/* Expense categories */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Expenses</h2>
        <Link
          href="/app/settings/expense-categories"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Expense Categories</div>
              <div className="text-xs text-ink-soft">
                Manage the category list shown on the Expenses entry form — add new ones, rename, or mark inactive.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
      </div>

      {/* Shift settings */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Shift settings</h2>
        <NightShiftToggle initialEnabled={nightEnabled} canEdit={canEditNight} />
      </div>

      {/* Costing defaults (CORR-T1) */}
      <div className="card p-5">
        <h2 className="font-display font-bold text-base mb-3">Costing defaults</h2>
        <CostingDefaults
          initialYarnPct={Number.isFinite(yarnPct) ? yarnPct : 0.02}
          initialPorvaiPct={Number.isFinite(porvaiPct) ? porvaiPct : 0.02}
          canEdit={canEditCosting}
        />
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
        <h2 className="font-display font-bold text-base mb-3">Users &amp; Roles</h2>
        <table className="w-full text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-ink-mute border-b border-line/60">
            <tr>
              <th className="text-left py-2">Name</th>
              <th className="text-left">Email</th>
