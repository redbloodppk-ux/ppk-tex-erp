import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ChevronRight, Settings2, Factory, Wallet, Layers, Ruler, Boxes, Store, BookOpen, BookMarked, ShieldAlert, Users } from 'lucide-react';
import { NightShiftToggle } from './night-shift-toggle';
import { CostingDefaults } from './costing-defaults';

export const metadata = { title: 'Settings' };

export default async function SettingsPage({
  searchParams,
}: { searchParams?: Promise<{ notice?: string }> }) {
  const sp = (await searchParams) ?? {};
  const notice = sp.notice === 'owner-only' ? 'owner-only' : null;
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
    // app_user.status is the real column (employee_status enum); the
    // legacy `is_active` boolean never existed on this table.
    supabase.from('app_user').select('id, email, full_name, role, status').order('full_name'),
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

      {notice === 'owner-only' && (
        <div className="card p-3 border-l-4 border-l-amber-500 bg-amber-50/40 text-sm text-amber-800 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          That page is restricted to the <strong>owner</strong> role. Ask an owner to grant access or make the change for you.
        </div>
      )}

      {/* Mill setup */}
      <div className="card p-5 space-y-3">
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
                Add looms, set status and fabric quality, and assign each loom to a weaving shed (1-4).
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/fabric-qualities"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Fabric Qualities</div>
              <div className="text-xs text-ink-soft">
                Cloth qualities (count / sort / article) a loom can be set up to weave. Width, weight and reference rate ₹/m live here.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/fabric-types"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Fabric Types</div>
              <div className="text-xs text-ink-soft">
                Master list of fabric categories (woven, towel, dupatta, …) shown on the Fabric Quality form&apos;s Fabric type dropdown.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/ends-master"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Ruler className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Ends Master</div>
              <div className="text-xs text-ink-soft">
                Standard warp-end specs (60, 80, 100…) pinned to a yarn count for use across bobbin, pavu and costing forms.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/bobbin-ends-master"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Ruler className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Bobbin Ends Master</div>
              <div className="text-xs text-ink-soft">
                Valid &ldquo;ends per bobbin&rdquo; specs (30, 40, 60, 80, 100…). Feeds into the Bobbin Master below.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/bobbins"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Ruler className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Bobbin Master</div>
              <div className="text-xs text-ink-soft">
                One row per (ends + production mode). BB-IH-30, BB-JW-30, BB-OS-30 coexist as separate stock balances and drive the dropdowns on the matching Add Bobbin Stock forms.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/yarn-counts"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Yarn Counts</div>
              <div className="text-xs text-ink-soft">
                Master of yarn counts (Ne / denier / tex). For polyester, Nec auto-computes as 5315 / denier.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/ledger-types"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <BookMarked className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Ledger Types</div>
              <div className="text-xs text-ink-soft">
                Ledger categories (SUPPLIER, CUSTOMER, TAX, BANK, AGENT...). Used by the New Ledger form.
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-ink-mute" />
        </Link>
        <Link
          href="/app/settings/ledger-groups"
          className="flex items-center justify-between gap-3 rounded-lg border border-line hover:border-indigo-300 hover:bg-indigo-50/40 p-3 transition"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="font-semibold">Ledger Groups</div>
              <div className="text-xs text-ink-soft">
                Account groups for P&L / Balance Sheet (SUNDRY CREDITORS, SUNDRY DEBTORS, INDIRECT EXPENSES...).
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
        <div className="flex items-start justify-between mb-3">
          <h2 className="font-display font-bold text-base">Company</h2>
          <Link href="/app/settings/company" className="btn-secondary text-xs">
            {company ? 'Edit' : 'Set up'}
          </Link>
        </div>
        {company ? (
          <dl className="grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-ink-soft">Legal Name</dt>
            <dd className="font-semibold">{(company as { legal_name: string }).legal_name}</dd>
            <dt className="text-ink-soft">GSTIN</dt>
            {/* Allow the GSTIN + verified badge to wrap on narrow phones
                so the badge doesn't spill past the right edge of the
                card. flex-wrap drops the badge to its own line below
                ~360 px screens; min-w-0 lets the GSTIN string truncate
                if it ever overflows. */}
            <dd className="num flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
              <span className="break-all">{(company as { gstin: string }).gstin}</span>
              {(company as { gstin_verified_at?: string | null }).gstin_verified_at && (
                <span title="GSTIN verified against the GST portal" className="inline-flex items-center gap-0.5 text-emerald-600 font-semibold text-[11px] shrink-0">
                  &#x2713; verified
                </span>
              )}
            </dd>
            <dt className="text-ink-soft">Address</dt>
            <dd>
              {(company as { address_line1: string }).address_line1}
              {(company as { address_line2?: string | null }).address_line2
                ? `, ${(company as { address_line2: string }).address_line2}`
                : ''}
              , {(company as { city: string }).city} {(company as { pincode: string }).pincode}
            </dd>
            <dt className="text-ink-soft">Phone</dt>
            <dd className="num">{(company as { phone?: string | null }).phone ?? '—'}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-soft">
            No company profile loaded yet.{' '}
            <Link href="/app/settings/company" className="text-indigo-700 font-semibold underline">
              Set it up now &rarr;
            </Link>
          </p>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-start justify-between mb-3">
          <h2 className="font-display font-bold text-base">Users &amp; Roles</h2>
          <Link href="/app/settings/users" className="btn-secondary text-xs">
            <Users className="w-3.5 h-3.5" /> Manage
          </Link>
        </div>
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
            {users?.length ? users.map((u: { id: string; full_name: string; email: string; role: string; status: string }) => (
              <tr key={u.id} className="border-b border-line/40 last:border-0">
                <td className="py-2.5 font-semibold">{u.full_name}</td>
                <td className="text-xs text-ink-soft">{u.email}</td>
                <td className="text-xs uppercase">{u.role.replace(/_/g, ' ')}</td>
                <td className="text-right">
                  <span className={`pill ${
                    u.status === 'active'
                      ? 'bg-emerald-50 text-emerald-700'
                      : u.status === 'resigned'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                  }`}>
                    {u.status}
                  </span>
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4} className="py-6 text-center text-ink-soft text-sm">No users yet.</td></tr>
            )}
          </tbody>
        </table>
        <p className="text-[11px] text-ink-mute mt-3">
          Owners can add new users, change roles and archive accounts via the <Link href="/app/settings/users" className="text-indigo-700 underline font-semibold">Manage</Link> page.
        </p>
      </div>
    </div>
  );
}
