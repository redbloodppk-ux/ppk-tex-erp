/**
 * Financial Summary report
 *
 * Snapshot of every party's receivable / payable AND a (mode, bucket)
 * matrix of warehouse stock-on-hand — both pinned to the end of a
 * chosen financial year (31-March of FY-end-year). Drives the
 * year-end review and tax-time data pull.
 *
 * Two server-side RPCs (migration 164) do the heavy lifting:
 *   fn_party_balances_as_of(date)   → per-party receivable + payable
 *   fn_warehouse_stock_as_of(date)  → (mode, bucket) → qty
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { Wallet, Boxes } from 'lucide-react';

export const metadata = { title: 'Financial Summary' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ fy?: string }>;
}

interface PartyBalanceRow {
  party_id: number;
  party_code: string | null;
  party_name: string;
  receivable: number | string;
  payable:    number | string;
}

interface StockRow {
  mode:     'inhouse' | 'jobwork' | 'outsource' | 'sizing' | string;
  bucket:   'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin' | string;
  quantity: number | string;
}

/** Indian FY runs 1-Apr → 31-Mar. Return the FY code for a date. */
function fyCodeOf(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Returns the last six FY codes ending with the current one. */
function recentFyCodes(): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear() - i, now.getMonth(), 1);
    out.push(fyCodeOf(d));
  }
  return Array.from(new Set(out));
}

/** End date (31-Mar of the END year) for a FY code like '26-27'. */
function fyEndDate(fy: string): string {
  const parts = fy.split('-');
  const endShort = Number(parts[1] ?? '0');
  // Pick the century by anchoring to current year ± 50: assumes the
  // operator isn't browsing FYs more than 50 years out.
  const currYY = new Date().getFullYear() % 100;
  const century = Math.floor(new Date().getFullYear() / 100) * 100;
  const endYear = endShort >= currYY - 50 && endShort <= currYY + 50
    ? century + endShort
    : century + 100 + endShort;
  return `${endYear}-03-31`;
}

function fmtINR(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtQty(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

const MODE_ORDER: Array<'inhouse' | 'jobwork' | 'outsource' | 'sizing'> = [
  'inhouse', 'jobwork', 'outsource', 'sizing',
];
const MODE_LABEL: Record<string, string> = {
  inhouse:   'In-house',
  jobwork:   'Job Work',
  outsource: 'Outsource',
  sizing:    'Sizing',
};

const BUCKET_ORDER: Array<'warp_beam' | 'weft_yarn' | 'porvai_yarn' | 'bobbin'> = [
  'warp_beam', 'weft_yarn', 'porvai_yarn', 'bobbin',
];
const BUCKET_LABEL: Record<string, string> = {
  warp_beam:   'Warp (m)',
  weft_yarn:   'Weft (kg)',
  porvai_yarn: 'Porvai (kg)',
  bobbin:      'Bobbin (m)',
};

export default async function FinancialSummaryReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const fyCodes = recentFyCodes();
  const fy = (sp.fy && fyCodes.includes(sp.fy)) ? sp.fy : (fyCodes[0] ?? '26-27');
  const asOf = fyEndDate(fy);

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const [partyRes, stockRes] = await Promise.all([
    sb.rpc('fn_party_balances_as_of', { p_as_of: asOf }),
    sb.rpc('fn_warehouse_stock_as_of', { p_as_of: asOf }),
  ]);

  const partyRows: PartyBalanceRow[] = (partyRes.data ?? []) as PartyBalanceRow[];
  const stockRows: StockRow[] = (stockRes.data ?? []) as StockRow[];

  // Reshape stock rows into a {mode: {bucket: qty}} matrix.
  const stockMap = new Map<string, Map<string, number>>();
  for (const r of stockRows) {
    const m = stockMap.get(r.mode) ?? new Map<string, number>();
    m.set(r.bucket, Number(r.quantity ?? 0));
    stockMap.set(r.mode, m);
  }

  const totalReceivable = partyRows.reduce((s, r) => s + Number(r.receivable ?? 0), 0);
  const totalPayable    = partyRows.reduce((s, r) => s + Number(r.payable ?? 0), 0);
  const netPosition     = totalReceivable - totalPayable;

  return (
    <div>
      <PageHeader
        title="Financial Summary"
        subtitle={`As of ${asOf} (FY ${fy})`}
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Financial Summary' }]}
      />

      {/* FY filter */}
      <div className="card p-3 mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-mute mr-1">Financial year:</span>
        {fyCodes.map((code) => {
          const active = code === fy;
          return (
            <Link
              key={code}
              href={`/app/reports/financial-summary?fy=${code}`}
              className={
                'px-3 py-1.5 rounded-md text-xs font-semibold border border-line ' +
                (active ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
              }
            >
              {code}
            </Link>
          );
        })}
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total Receivable</div>
          <div className="num text-xl font-bold text-emerald-700">₹ {fmtINR(totalReceivable)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total Payable</div>
          <div className="num text-xl font-bold text-rose-700">₹ {fmtINR(totalPayable)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Net Position</div>
          <div className={'num text-xl font-bold ' + (netPosition >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
            {netPosition >= 0 ? '+' : ''}₹ {fmtINR(netPosition)}
          </div>
        </div>
      </div>

      {/* Party-wise receivable / payable */}
      <section className="card p-5 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <Wallet className="w-4 h-4 text-indigo-700" />
          <h2 className="font-display font-bold text-base">Party Balances</h2>
        </div>
        {partyRows.length === 0 ? (
          <p className="text-sm text-ink-soft">No open balances as of {asOf}.</p>
        ) : (
          <>
          {/* Mobile / PWA: card view. Below md each party becomes a
              tap-friendly card. */}
          <CardFilter placeholder="Search parties…">
            {partyRows.map((r) => {
              const recv = Number(r.receivable ?? 0);
              const pay = Number(r.payable ?? 0);
              const net = recv - pay;
              return (
                <div key={r.party_id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-semibold text-ink break-words">{r.party_name}</div>
                      {r.party_code ? (
                        <div className="font-mono text-xs text-ink-mute mt-0.5">{r.party_code}</div>
                      ) : null}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[10px] uppercase tracking-wide text-ink-mute">Net</div>
                      <div className={'num font-semibold text-base ' + (net >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                        {net >= 0 ? '+' : ''}{fmtINR(net)}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 text-xs text-ink-soft mt-2 pt-2 border-t border-line/40">
                    <div className="text-emerald-700">Receivable: <span className="num">{recv > 0 ? fmtINR(recv) : '—'}</span></div>
                    <div className="text-rose-700">Payable: <span className="num">{pay > 0 ? fmtINR(pay) : '—'}</span></div>
                  </div>
                </div>
              );
            })}
          </CardFilter>

          <div className="overflow-x-auto hidden md:block">
            <table className="w-full text-sm">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft border-b border-line/60">
                <tr>
                  <th className="text-left  px-3 py-2">Code</th>
                  <th className="text-left  px-3 py-2">Party</th>
                  <th className="text-right px-3 py-2">Receivable (₹)</th>
                  <th className="text-right px-3 py-2">Payable (₹)</th>
                  <th className="text-right px-3 py-2">Net (₹)</th>
                </tr>
              </thead>
              <tbody>
                {partyRows.map((r) => {
                  const recv = Number(r.receivable ?? 0);
                  const pay  = Number(r.payable ?? 0);
                  const net  = recv - pay;
                  return (
                    <tr key={r.party_id} className="border-b border-line/40 last:border-0 hover:bg-haze/60">
                      <td className="px-3 py-2 font-mono text-xs">{r.party_code ?? ''}</td>
                      <td className="px-3 py-2 font-medium">{r.party_name}</td>
                      <td className="px-3 py-2 text-right num text-emerald-700">{recv > 0 ? fmtINR(recv) : '—'}</td>
                      <td className="px-3 py-2 text-right num text-rose-700">{pay > 0 ? fmtINR(pay) : '—'}</td>
                      <td className={'px-3 py-2 text-right num font-semibold ' + (net >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                        {net >= 0 ? '+' : ''}{fmtINR(net)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-line bg-cloud/30 font-semibold text-sm">
                <tr>
                  <td colSpan={2} className="px-3 py-2 text-right uppercase text-[11px] text-ink-soft">Total</td>
                  <td className="px-3 py-2 text-right num text-emerald-700">₹ {fmtINR(totalReceivable)}</td>
                  <td className="px-3 py-2 text-right num text-rose-700">₹ {fmtINR(totalPayable)}</td>
                  <td className={'px-3 py-2 text-right num ' + (netPosition >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                    {netPosition >= 0 ? '+' : ''}₹ {fmtINR(netPosition)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          </>
        )}
      </section>

      {/* Warehouse stock matrix */}
      <section className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Boxes className="w-4 h-4 text-amber-700" />
          <h2 className="font-display font-bold text-base">Warehouse Stock — by mode &amp; bucket</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft border-b border-line/60">
              <tr>
                <th className="text-left px-3 py-2">Warehouse</th>
                {BUCKET_ORDER.map((b) => (
                  <th key={b} className="text-right px-3 py-2">{BUCKET_LABEL[b]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODE_ORDER.map((mode) => {
                const row = stockMap.get(mode);
                const hasAny = BUCKET_ORDER.some((b) => Math.abs(Number(row?.get(b) ?? 0)) > 0.005);
                return (
                  <tr key={mode} className="border-b border-line/40 last:border-0">
                    <td className="px-3 py-2 font-semibold">{MODE_LABEL[mode]}</td>
                    {BUCKET_ORDER.map((b) => {
                      const q = Number(row?.get(b) ?? 0);
                      return (
                        <td key={b} className={'px-3 py-2 text-right num ' + (q < 0 ? 'text-rose-600' : '')}>
                          {hasAny ? fmtQty(q) : <span className="text-ink-mute/40">—</span>}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 border-line bg-cloud/30 text-[11px] uppercase tracking-wide text-ink-soft font-semibold">
              <tr>
                <td className="px-3 py-2 text-right">Total</td>
                {BUCKET_ORDER.map((b) => {
                  const total = MODE_ORDER.reduce((s, m) => s + Number(stockMap.get(m)?.get(b) ?? 0), 0);
                  return (
                    <td key={b} className={'px-3 py-2 text-right num ' + (total < 0 ? 'text-rose-600' : 'text-ink')}>
                      {fmtQty(total)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="text-[10px] text-ink-mute mt-3">
          Warp is in metres, Weft and Porvai in kg, Bobbin in metres. Negative figures (rose) indicate the ledger
          has issued more than the opening balance — typically caused by a missing opening_stock entry for that mode/bucket.
        </p>
      </section>
    </div>
  );
}
