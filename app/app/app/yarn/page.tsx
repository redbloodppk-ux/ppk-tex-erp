import { createClient } from '@/lib/supabase/server';
import { PageHeader, ComingSoon } from '@/app/components/page-header';
import { formatKg, formatRupee, formatDate } from '@/lib/utils';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Yarn & Suppliers' };

export default async function YarnPage() {
  const supabase = await createClient();
  const [{ data: lots }, { data: cover }] = await Promise.all([
    // Yarn suppliers moved into the unified party table (migration 098).
    // We join the supplier party for its name and the yarn_count master
    // for its code. Field names from the yarn_lot table itself are
    // lot_code, current_kg, cost_per_kg, received_date.
    //
    // IN-HOUSE ONLY (PPK, 2026-09-14: "SHOW ONLY IN HOUSE ONLY here").
    // delivery_destination = 'sizing' means the lot was bought and sent
    // straight to the sizing mill - it never arrives at the yarn store, so
    // it does not belong on a page about what is on the shelf. Five of the
    // twenty-one lots are like that; all of them from the two spinning
    // mills whose yarn goes direct for sizing.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).from('yarn_lot').select(`
      id, lot_code, current_kg, cost_per_kg, received_date,
      yarn_count:yarn_count_id ( code ),
      supplier:supplier_party_id ( name )
    `)
      .eq('delivery_destination', 'in_house')
      .order('received_date', { ascending: false }).limit(30),
    // v_yarn_days_of_cover counts in-house lots only since migration 299,
    // so the cards and the list below agree about what "on hand" means.
    supabase.from('v_yarn_days_of_cover').select('yarn_count_code, on_hand_kg, days_of_cover').order('days_of_cover'),
  ]);

  // Only counts actually on the shelf get a card. Ordered by cover, so the
  // one closest to running out leads.
  //
  // Before this the cards showed the SIX LOWEST covers out of every active
  // count, which meant six counts sitting at zero and every card reading
  // "0.0 kg" - including C-30 and C-40, whose yarn all goes to sizing and
  // never enters the store at all. A count at zero is not a cover warning,
  // it is an empty shelf; the reorder flag on Stock On Hand is the place
  // that belongs.
  const onShelf = (cover ?? []).filter((c: any) => Number(c.on_hand_kg) > 0);

  return (
    <div>
      <PageHeader
        title="Yarn & Suppliers"
        subtitle="Yarn delivered to the mill — purchase lots and days-of-cover by count. Lots sent straight to the sizing mill are not shown."
      />

      {onShelf.length === 0 ? (
        <div className="card p-4 mb-6 text-sm text-ink-mute">
          No yarn on hand. Every in-house lot has been consumed.
        </div>
      ) : (
        <section className="grid lg:grid-cols-3 gap-4 mb-6">
          {onShelf.slice(0, 6).map((c: any) => (
            <div key={c.yarn_count_code} className="card p-4">
              <div className="text-xs uppercase tracking-wider text-ink-mute">{c.yarn_count_code}</div>
              <div className="num text-xl font-bold mt-1">{formatKg(c.on_hand_kg)}</div>
              <div className={`text-xs mt-0.5 num ${Number(c.days_of_cover) <= 14 ? 'text-rose-600 font-semibold' : 'text-ink-soft'}`}>
                {Number(c.days_of_cover).toFixed(1)} days cover
              </div>
            </div>
          ))}
        </section>
      )}

      {!lots?.length ? (
        <ComingSoon note="No in-house yarn lots yet. Use the Yarn Purchase form to enter incoming bales." />
      ) : (
        <>
        {/* Mobile / PWA: card view. The yarn lots table is wide; below md
            we render each lot as a tap-friendly card. The table is hidden
            on mobile. */}
        <CardFilter placeholder="Search yarn lots…">
          {lots.map((l: any) => (
            <div key={l.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold text-ink break-words">{l.lot_code}</div>
                  <div className="font-semibold text-ink mt-0.5">{l.yarn_count?.code ?? '—'}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="num font-semibold">{formatKg(l.current_kg)}</div>
                  <div className="num text-xs text-ink-soft">{formatRupee(l.cost_per_kg, { decimals: 2 })}/kg</div>
                </div>
              </div>
              <div className="text-xs text-ink-soft mt-2">
                <span className="text-ink-mute">Supplier: </span>{l.supplier?.name ?? '—'}
              </div>
              <div className="text-xs text-ink-soft mt-1">
                <span className="text-ink-mute">Received: </span>{formatDate(l.received_date)}
              </div>
            </div>
          ))}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
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
        </>
      )}
    </div>
  );
}
