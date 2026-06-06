import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import { formatKg, formatRupee, formatDate } from '@/lib/utils';

export const metadata = { title: 'Yarn & Suppliers' };

export default async function YarnPage() {
  const supabase = await createClient();
  const [{ data: lots }, { data: cover }] = await Promise.all([
    // Yarn suppliers moved into the unified party table (migration 098).
    // We join the supplier party for its name and the yarn_count master
    // for its code. Field names from the yarn_lot table itself are
    // lot_code, current_kg, cost_per_kg, received_date.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('yarn_lot').select(`
      id, lot_code, current_kg, cost_per_kg, received_date,
      yarn_count:yarn_count_id ( code ),
      supplier:supplier_party_id ( name )
    `).order('received_date', { ascending: false }).limit(30),
    supabase.from('v_yarn_days_of_cover').select('yarn_count_code, on_hand_kg, days_of_cover').order('days_of_cover'),
  ]);

  return (
    <div>
      <PageHeader title="Yarn & Suppliers" subtitle="Yarn purchase lots, supplier scorecards and days-of-cover by count." />

      <section className="grid lg:grid-cols-3 gap-4 mb-6">
        {(cover ?? []).slice(0, 6).map((c: any) => (
          <div key={c.yarn_count_code} className="card p-4">
            <div className="text-xs uppercase tracking-wider text-ink-mute">{c.yarn_count_code}</div>
            <div className="num text-xl font-bold mt-1">{formatKg(c.on_hand_kg)}</div>
            <div className={`text-xs mt-0.5 num ${Number(c.days_of_cover) <= 14 ? 'text-rose-600 font-semibold' : 'text-ink-soft'}`}>
              {Number(c.days_of_cover).toFixed(1)} days cover
            </div>
          </div>
        ))}
      </section>

      {!lots?.length ? (
        <ComingSoon note="No yarn lots yet. Use the Yarn Purchase form to enter incoming bales." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left px-4 py-3">Lot No</th>
                <th className="text-left px-4 py-3">Count</th>
                <th className="text-left px-4 py-3">Supplier</th>
                <th className="text-right px-4 py-3">Qty</th>
                <th className="text-right px-4 py-3">Rate</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">Received</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l: any) => (
                <tr key={l.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs">{l.lot_code}</td>
                  <td className="px-4 py-3 font-semibold">{l.yarn_count?.code ?? '—'}</td>
                  <td className="px-4 py-3">{l.supplier?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-right num">{formatKg(l.current_kg)}</td>
                  <td className="px-4 py-3 text-right num">{formatRupee(l.cost_per_kg, { decimals: 2 })}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft hidden md:table-cell">{formatDate(l.received_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
