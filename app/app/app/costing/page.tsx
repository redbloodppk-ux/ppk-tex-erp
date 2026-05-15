import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import Link from 'next/link';
import { formatRupee } from '@/lib/utils';
import { Plus, Calculator } from 'lucide-react';

export const metadata = { title: 'Fabric Costing' };

export default async function CostingPage() {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('v_costing_two_cost')
    .select('id, code, name, status, quoted_cost_per_m, true_cost_per_m, selling_price_per_m, business_model, updated_at')
    .order('updated_at', { ascending: false })
    .limit(50);

  return (
    <div>
      <PageHeader
        title="Fabric Costing"
        subtitle="Two-cost model: Quoted (market pick) vs True (LOOMS overhead or vendor pick)."
        actions={
          <div className="flex gap-2">
            <Link href="/app/costing-calc" className="btn-ghost">
              <Calculator className="w-4 h-4" /> Quick Calc
            </Link>
            <Link href="/app/costing/new" className="btn-primary">
              <Plus className="w-4 h-4" /> New Costing
            </Link>
          </div>
        }
      />

      {!rows?.length ? (
        <ComingSoon note="No costing entries yet. Use the Quick Calc to play with numbers, or create a saved costing master to lock the figures." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-3">Code</th>
                <th className="text-left px-4 py-3">Quality Name</th>
                <th className="text-left px-4 py-3">Model</th>
                <th className="text-right px-4 py-3">Quoted ₹/m</th>
                <th className="text-right px-4 py-3">True ₹/m</th>
                <th className="text-right px-4 py-3">Selling ₹/m</th>
                <th className="text-right px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs">{r.code}</td>
                  <td className="px-4 py-3 font-semibold">{r.name}</td>
                  <td className="px-4 py-3 text-xs uppercase">{r.business_model}</td>
                  <td className="px-4 py-3 text-right num text-indigo-700 font-semibold">{formatRupee(r.quoted_cost_per_m, { decimals: 2 })}</td>
                  <td className="px-4 py-3 text-right num text-amber-700 font-semibold">{formatRupee(r.true_cost_per_m,   { decimals: 2 })}</td>
                  <td className="px-4 py-3 text-right num text-violet-700 font-semibold">{formatRupee(r.selling_price_per_m, { decimals: 2 })}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`pill ${r.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
