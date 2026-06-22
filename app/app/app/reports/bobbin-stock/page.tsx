/**
 * Bobbin Stock report — one row per in-house bobbin spec showing the
 * full in / out / balance picture:
 *
 *   IN   opening stock (metres) + purchases (pcs × m/pc)
 *   OUT  weaving consumption (stock_ledger bobbin outflows, metres)
 *   PCS  pieces purchased vs EMPTY spools returned to the supplier
 *        (returns are piece tracking only — they never reduce the
 *        yarn-metre balance)
 *
 * Balance (m) = opening + purchased − consumed.
 * Spools on hand ≈ opening pcs + purchased pcs − returned pcs.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';

export const metadata = { title: 'Bobbin Stock Report' };
export const dynamic = 'force-dynamic';

interface Row {
  id: number;
  code: string;
  ends: number;
  per: number;            // metres per piece
  opening_m: number;
  purchased_pcs: number;
  purchased_m: number;
  consumed_m: number;
  returned_pcs: number;
  balance_m: number;
  spools_on_hand: number;
}

function fmt(n: number, d = 1): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export default async function BobbinStockReportPage() {
  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const [bobRes, openRes, purRes, retRes, outRes] = await Promise.all([
    sb.from('bobbin')
      .select('id, code, ends_per_bobbin, bobbin_metre, production_mode')
      .eq('production_mode', 'inhouse')
      .neq('status', 'archived')
      .order('ends_per_bobbin'),
    sb.from('opening_stock')
      .select('bobbin_id, quantity')
      .eq('bucket', 'bobbin').eq('mode', 'inhouse').eq('status', 'active'),
    sb.from('bobbin_purchase').select('bobbin_id, pieces_purchased'),
    sb.from('bobbin_return')
      .select('bobbin_id, quantity_pcs')
      .is('jobwork_party_id', null).eq('status', 'active'),
    sb.from('stock_ledger')
      .select('bobbin_id, quantity')
      .eq('bucket', 'bobbin').eq('direction', 'out')
      .is('jobwork_party_id', null),
  ]);

  const sum = (rows: Array<{ bobbin_id: number | null; v: number }>): Map<number, number> => {
    const m = new Map<number, number>();
    for (const r of rows) {
      if (r.bobbin_id == null) continue;
      m.set(r.bobbin_id, (m.get(r.bobbin_id) ?? 0) + r.v);
    }
    return m;
  };
  const openingByBobbin = sum(((openRes.data ?? []) as Array<{ bobbin_id: number | null; quantity: number | string | null }>)
    .map((r) => ({ bobbin_id: r.bobbin_id, v: Number(r.quantity ?? 0) })));
  const purchasedByBobbin = sum(((purRes.data ?? []) as Array<{ bobbin_id: number | null; pieces_purchased: number | string | null }>)
    .map((r) => ({ bobbin_id: r.bobbin_id, v: Number(r.pieces_purchased ?? 0) })));
  const returnedByBobbin = sum(((retRes.data ?? []) as Array<{ bobbin_id: number | null; quantity_pcs: number | string | null }>)
    .map((r) => ({ bobbin_id: r.bobbin_id, v: Number(r.quantity_pcs ?? 0) })));
  const consumedByBobbin = sum(((outRes.data ?? []) as Array<{ bobbin_id: number | null; quantity: number | string | null }>)
    .map((r) => ({ bobbin_id: r.bobbin_id, v: Number(r.quantity ?? 0) })));

  const rows: Row[] = (((bobRes.data ?? []) as Array<{
    id: number; code: string; ends_per_bobbin: number | null; bobbin_metre: number | string | null;
  }>)).map((b) => {
    const per = Number(b.bobbin_metre ?? 0);
    const opening_m = openingByBobbin.get(b.id) ?? 0;
    const purchased_pcs = purchasedByBobbin.get(b.id) ?? 0;
    const purchased_m = per > 0 ? purchased_pcs * per : 0;
    const consumed_m = consumedByBobbin.get(b.id) ?? 0;
    const returned_pcs = returnedByBobbin.get(b.id) ?? 0;
    const opening_pcs = per > 0 ? opening_m / per : 0;
    return {
      id: b.id,
      code: b.code,
      ends: Number(b.ends_per_bobbin ?? 0),
      per,
      opening_m,
      purchased_pcs,
      purchased_m,
      consumed_m,
      returned_pcs,
      balance_m: opening_m + purchased_m - consumed_m,
      spools_on_hand: opening_pcs + purchased_pcs - returned_pcs,
    };
  });

  const totals = rows.reduce(
    (t, r) => ({
      opening_m: t.opening_m + r.opening_m,
      purchased_pcs: t.purchased_pcs + r.purchased_pcs,
      purchased_m: t.purchased_m + r.purchased_m,
      consumed_m: t.consumed_m + r.consumed_m,
      returned_pcs: t.returned_pcs + r.returned_pcs,
      balance_m: t.balance_m + r.balance_m,
      spools_on_hand: t.spools_on_hand + r.spools_on_hand,
    }),
    { opening_m: 0, purchased_pcs: 0, purchased_m: 0, consumed_m: 0, returned_pcs: 0, balance_m: 0, spools_on_hand: 0 },
  );

  return (
    <div>
      <PageHeader
        title="Bobbin Stock"
        subtitle="In / out / balance for every in-house bobbin. Returns to supplier are EMPTY spools — they count in pieces only and never reduce the metre balance."
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Bobbin Stock' }]}
      />

      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-ink-soft">No in-house bobbins in the master yet.</div>
      ) : (
        <>
        <CardFilter placeholder="Search bobbins…">
          {rows.map((r) => (
            <div key={r.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="font-mono font-semibold text-ink break-words">{r.code}</div>
                <div className="text-right shrink-0">
                  <span className={'num font-bold text-base ' + (r.balance_m < 0 ? 'text-rose-700' : 'text-emerald-700')}>{fmt(r.balance_m)}</span>
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">balance (m)</div>
                </div>
              </div>
              <div className="text-xs text-ink-soft mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <div>Ends: <span className="num">{r.ends}</span></div>
                <div>m / pc: <span className="num">{fmt(r.per, 0)}</span></div>
                <div>Opening (m): <span className="num">{fmt(r.opening_m)}</span></div>
                <div>Purchased (pcs): <span className="num text-emerald-700">{fmt(r.purchased_pcs, 0)}</span></div>
                <div>Purchased (m): <span className="num text-emerald-700">+ {fmt(r.purchased_m)}</span></div>
                <div>Consumed (m): <span className="num text-rose-700">{'\u2212'} {fmt(r.consumed_m)}</span></div>
                <div>Returned (pcs): <span className="num text-amber-700">{fmt(r.returned_pcs, 0)}</span></div>
                <div>Spools on hand: <span className={'num font-semibold ' + (r.spools_on_hand < 0 ? 'text-rose-700' : '')}>{fmt(r.spools_on_hand, 1)}</span></div>
              </div>
            </div>
          ))}
        </CardFilter>
        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm min-w-[980px]">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-3 py-3">Bobbin</th>
                <th className="text-right px-3 py-3">Ends</th>
                <th className="text-right px-3 py-3">m / pc</th>
                <th className="text-right px-3 py-3">Opening (m)</th>
                <th className="text-right px-3 py-3">Purchased (pcs)</th>
                <th className="text-right px-3 py-3">Purchased (m)</th>
                <th className="text-right px-3 py-3" title="Weaving consumption from fabric receipts">Consumed (m)</th>
                <th className="text-right px-3 py-3" title="Empty spools sent back — pieces only, no metre effect">Returned (pcs)</th>
                <th className="text-right px-3 py-3">Balance (m)</th>
                <th className="text-right px-3 py-3" title="Opening pcs + purchased − returned">Spools on hand</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 font-mono text-xs font-semibold">{r.code}</td>
                  <td className="px-3 py-2 text-right num">{r.ends}</td>
                  <td className="px-3 py-2 text-right num text-ink-soft">{fmt(r.per, 0)}</td>
                  <td className="px-3 py-2 text-right num">{fmt(r.opening_m)}</td>
                  <td className="px-3 py-2 text-right num text-emerald-700">{fmt(r.purchased_pcs, 0)}</td>
                  <td className="px-3 py-2 text-right num text-emerald-700">+ {fmt(r.purchased_m)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">{'\u2212'} {fmt(r.consumed_m)}</td>
                  <td className="px-3 py-2 text-right num text-amber-700">{fmt(r.returned_pcs, 0)}</td>
                  <td className={'px-3 py-2 text-right num font-bold ' + (r.balance_m < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                    {fmt(r.balance_m)}
                  </td>
                  <td className={'px-3 py-2 text-right num font-semibold ' + (r.spools_on_hand < 0 ? 'text-rose-700' : '')}>
                    {fmt(r.spools_on_hand, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-line bg-cloud/30 font-bold">
              <tr>
                <td className="px-3 py-2" colSpan={3}>Total</td>
                <td className="px-3 py-2 text-right num">{fmt(totals.opening_m)}</td>
                <td className="px-3 py-2 text-right num text-emerald-700">{fmt(totals.purchased_pcs, 0)}</td>
                <td className="px-3 py-2 text-right num text-emerald-700">+ {fmt(totals.purchased_m)}</td>
                <td className="px-3 py-2 text-right num text-rose-700">{'\u2212'} {fmt(totals.consumed_m)}</td>
                <td className="px-3 py-2 text-right num text-amber-700">{fmt(totals.returned_pcs, 0)}</td>
                <td className={'px-3 py-2 text-right num ' + (totals.balance_m < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                  {fmt(totals.balance_m)}
                </td>
                <td className={'px-3 py-2 text-right num ' + (totals.spools_on_hand < 0 ? 'text-rose-700' : '')}>
                  {fmt(totals.spools_on_hand, 1)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
