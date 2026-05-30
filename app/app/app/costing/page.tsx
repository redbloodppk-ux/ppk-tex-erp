import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import { Plus, Calculator, ClipboardCheck, Pencil } from 'lucide-react';
import { CostingActiveToggle } from '@/app/components/costing-active-toggle';
import { CostingDeleteButton } from '@/app/components/costing-delete-button';

export const metadata = { title: 'Fabric Costing' };

interface MasterRow {
  id: number;
  quality_code: string | null;
  quality_name: string | null;
  status: string | null;
  approval_status: string | null;
  production_mode: string | null;
  fabric_type: string | null;
  fabric_width_in: number | null;
  gsm: number | null;
  updated_at: string | null;
}

interface CostRow {
  id: number;
  quoted_cost_per_m: number | null;
  true_cost_per_m: number | null;
}

export default async function CostingPage() {
  const supabase = await createClient();
  const [
    { data: masters },
    { data: costs },
    { count: pendingCount },
    { data: { user } },
  ] = await Promise.all([
    supabase
      .from('costing_master')
      .select('id, quality_code, quality_name, status, approval_status, production_mode, fabric_type, fabric_width_in, gsm, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200),
    supabase
      .from('v_costing_two_cost')
      .select('id, quoted_cost_per_m, true_cost_per_m'),
    supabase
      .from('costing_master')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'pending')
      .eq('status', 'active'),
    supabase.auth.getUser(),
  ]);

  let canSeeApprovals = false;
  if (user) {
    const { data: me } = await supabase
      .from('app_user').select('role').eq('id', user.id).maybeSingle();
    const role = (me as { role: string } | null)?.role;
    canSeeApprovals = role === 'owner' || role === 'auditor';
  }

  const masterList = (masters ?? []) as unknown as MasterRow[];
  const costList = (costs ?? []) as unknown as CostRow[];
  const costById = new Map<number, CostRow>();
  for (const c of costList) costById.set(c.id, c);

  return (
    <div>
      <PageHeader
        title="Fabric Costing"
        subtitle="Saved costings. Toggle Active to keep a row in use, or untoggle to archive it."
        actions={
          <div className="flex gap-2 flex-wrap">
            {canSeeApprovals && (
              <Link
                href="/app/costing/approvals"
                className={`btn-ghost relative ${pendingCount && pendingCount > 0 ? 'border-amber-300 text-amber-800' : ''}`}
              >
                <ClipboardCheck className="w-4 h-4" /> Approvals
                {pendingCount && pendingCount > 0 ? (
                  <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-[11px] font-bold num">
                    {pendingCount}
                  </span>
                ) : null}
              </Link>
            )}
            <Link href="/app/costing-calc" className="btn-ghost">
              <Calculator className="w-4 h-4" /> Quick Calc
            </Link>
            <Link href="/app/costing/new" className="btn-primary">
              <Plus className="w-4 h-4" /> New Costing
            </Link>
          </div>
        }
      />

      {pendingCount && pendingCount > 0 ? (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <span className="font-semibold">{pendingCount}</span> costing{pendingCount === 1 ? '' : 's'} waiting for owner approval.
            Sales Orders cannot price against pending costings.
          </div>
          {canSeeApprovals && (
            <Link href="/app/costing/approvals" className="text-amber-900 font-semibold underline decoration-dotted hover:no-underline">
              Review now →
            </Link>
          )}
        </div>
      ) : null}

      {masterList.length === 0 ? (
        <ComingSoon note="No costing entries yet. Use the Quick Calc to play with numbers, or click New Costing to save one." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Quality Name</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Mode</th>
                <th className="text-right px-4 py-3">Width (in)</th>
                <th className="text-right px-4 py-3">GSM</th>
                <th className="text-right px-4 py-3">Quoted ₹/m</th>
                <th className="text-right px-4 py-3">True ₹/m</th>
                <th className="text-center px-4 py-3">Approval</th>
                <th className="text-center px-4 py-3">Active</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {masterList.map((r) => {
                const c = costById.get(r.id);
                return (
                  <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-4 py-3 font-mono text-xs">{r.quality_code ?? '-'}</td>
                    <td className="px-4 py-3 font-semibold">{r.quality_name ?? '-'}</td>
                    <td className="px-4 py-3 text-xs uppercase">{r.fabric_type ?? '-'}</td>
                    <td className="px-4 py-3 text-xs uppercase">{r.production_mode ?? '-'}</td>
                    <td className="px-4 py-3 text-right num">{r.fabric_width_in ?? '-'}</td>
                    <td className="px-4 py-3 text-right num">{r.gsm ?? '-'}</td>
                    <td className="px-4 py-3 text-right num text-indigo-700 font-semibold">
                      {c ? formatRupee(c.quoted_cost_per_m, { decimals: 2 }) : '-'}
                    </td>
                    <td className="px-4 py-3 text-right num text-amber-700 font-semibold">
                      {c ? formatRupee(c.true_cost_per_m, { decimals: 2 }) : '-'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`pill ${r.approval_status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700'
                        : r.approval_status === 'rejected'
                          ? 'bg-rose-50 text-rose-700'
                          : 'bg-amber-50 text-amber-700'}`}>
                        {r.approval_status ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <CostingActiveToggle id={r.id} initialActive={r.status === 'active'} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-3">
                        <Link
                          href={`/app/costing/${r.id}`}
                          className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900 font-semibold"
                        >
                          <Pencil className="w-3 h-3" /> Edit
                        </Link>
                        <CostingDeleteButton id={r.id} code={r.quality_code} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
