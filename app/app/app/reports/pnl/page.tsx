/**
 * /app/reports/pnl — Period Profit & Loss.
 *
 * Single-screen P&L for any date window. Pulls revenue, COGS, period
 * expenses (wages + factory expenses + bank entries flagged
 * pl_treatment='expense'), bank income, and computes gross + net
 * profit. Balance-sheet items (cash withdrawal, loan principal, GST
 * payment, loan disbursement, cash deposit) are excluded by the
 * underlying SQL function — they don't affect profit.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';

export const metadata = { title: 'Period P&L' };
export const dynamic = 'force-dynamic';

interface PnlRow {
  period_from: string;
  period_to: string;
  revenue: number | string;
  credit_notes: number | string;
  cogs: number | string;
  gross_profit: number | string;
  wages: number | string;
  factory_expenses: number | string;
  bank_expenses: number | string;
  bank_income: number | string;
  period_costs: number | string;
  net_profit: number | string;
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; preset?: string }>;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function thisMonthRange(): { from: string; to: string } {
  const now = new Date();
  return {
    from: isoDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    to:   isoDate(now),
  };
}

function presetRange(preset: string | undefined): { from: string; to: string } | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (preset === 'this_month') return thisMonthRange();
  if (preset === 'last_month') {
    const start = new Date(y, m - 1, 1);
    const end   = new Date(y, m, 0);
    return { from: isoDate(start), to: isoDate(end) };
  }
  if (preset === 'this_quarter') {
    const q = Math.floor(m / 3);
    const start = new Date(y, q * 3, 1);
    return { from: isoDate(start), to: isoDate(now) };
  }
  if (preset === 'fy_to_date') {
    // Indian FY starts 1 April.
    const fyStart = m >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
    return { from: isoDate(fyStart), to: isoDate(now) };
  }
  if (preset === 'last_30d') {
    const start = new Date(now);
    start.setDate(start.getDate() - 30);
    return { from: isoDate(start), to: isoDate(now) };
  }
  return null;
}

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export default async function PeriodPnlPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  // Explicit truthy check — `sp.preset && presetRange(sp.preset)` would
  // short-circuit to "" (the empty string) when sp.preset is empty,
  // narrowing the type to `string | {from,to}` and breaking `?.from`
  // access. Ternary keeps `preset` as `{from,to} | null`.
  const preset = sp.preset ? presetRange(sp.preset) : null;
  const fromInput = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const toInput   = sp.to   && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)   ? sp.to   : null;

  const def = thisMonthRange();
  const from = fromInput ?? preset?.from ?? def.from;
  const to   = toInput   ?? preset?.to   ?? def.to;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  const { data: rows, error } = await sb.rpc('fn_period_pnl', { p_from: from, p_to: to });
  const row: PnlRow | null = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);

  const revenue         = num(row?.revenue);
  const creditNotes     = num(row?.credit_notes);
  const netRevenue      = revenue - creditNotes;
  const cogs            = num(row?.cogs);
  const grossProfit     = num(row?.gross_profit);
  const wages           = num(row?.wages);
  const factoryExpenses = num(row?.factory_expenses);
  const bankExpenses    = num(row?.bank_expenses);
  const bankIncome      = num(row?.bank_income);
  const periodCosts     = num(row?.period_costs);
  const netProfit       = num(row?.net_profit);

  return (
    <div>
      <PageHeader
        title="Period Profit & Loss"
        subtitle="Revenue minus COGS, period expenses, plus bank income. Balance-sheet items (cash withdrawals, loan principal, GST payment) are excluded so profit isn't double-counted."
      />

      {/* Period picker */}
      <form action="/app/reports/pnl" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">From</span>
          <input name="from" type="date" defaultValue={from} className="input py-1 text-xs" />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">To</span>
          <input name="to" type="date" defaultValue={to} className="input py-1 text-xs" />
        </label>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        <div className="flex items-center gap-1 ml-auto text-[11px]">
          <span className="text-ink-mute">Quick:</span>
          <Link href="/app/reports/pnl?preset=this_month"   className="text-indigo-700 underline">This month</Link>
          <span className="text-ink-mute">·</span>
          <Link href="/app/reports/pnl?preset=last_month"   className="text-indigo-700 underline">Last month</Link>
          <span className="text-ink-mute">·</span>
          <Link href="/app/reports/pnl?preset=this_quarter" className="text-indigo-700 underline">Quarter</Link>
          <span className="text-ink-mute">·</span>
          <Link href="/app/reports/pnl?preset=fy_to_date"   className="text-indigo-700 underline">FY-to-date</Link>
          <span className="text-ink-mute">·</span>
          <Link href="/app/reports/pnl?preset=last_30d"     className="text-indigo-700 underline">Last 30d</Link>
        </div>
      </form>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load P&L: {error.message}</div>
      )}

      {/* Header KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Net Revenue</div>
          <div className="num text-xl font-bold text-emerald-700">{formatRupee(netRevenue, { compact: true })}</div>
          {creditNotes > 0 && (
            <div className="text-[10px] text-ink-mute">Gross {formatRupee(revenue, { compact: true })} &minus; CN {formatRupee(creditNotes, { compact: true })}</div>
          )}
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Gross Profit</div>
          <div className={'num text-xl font-bold ' + (grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
            {formatRupee(grossProfit, { compact: true })}
          </div>
          <div className="text-[10px] text-ink-mute">Margin: {pct(grossProfit, netRevenue)}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Period Costs</div>
          <div className="num text-xl font-bold text-rose-700">{formatRupee(periodCosts, { compact: true })}</div>
        </div>
        <div className="card p-3 border-2 border-indigo-300">
          <div className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold">Net Profit</div>
          <div className={'num text-2xl font-extrabold ' + (netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
            {formatRupee(netProfit, { compact: true })}
          </div>
          <div className="text-[10px] text-ink-mute">Margin: {pct(netProfit, netRevenue)}</div>
        </div>
      </div>

      {/* Itemised P&L */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3">Line</th>
              <th className="text-right px-3 py-3">Amount</th>
              <th className="text-right px-3 py-3">% of Net Rev.</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-line/40">
              <td className="px-3 py-2 font-semibold">Revenue (sales / yarn / service invoices)</td>
              <td className="px-3 py-2 text-right num font-semibold text-emerald-700">+ {formatRupee(revenue, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(revenue, netRevenue)}</td>
            </tr>
            {creditNotes > 0 && (
              <tr className="border-t border-line/40">
                <td className="px-3 py-2 pl-6 text-ink-soft">Less: Credit Notes</td>
                <td className="px-3 py-2 text-right num text-rose-700">&minus; {formatRupee(creditNotes, { decimals: 0 })}</td>
                <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(-creditNotes, netRevenue)}</td>
              </tr>
            )}
            <tr className="border-t border-line/40 bg-cloud/30 font-semibold">
              <td className="px-3 py-2">Net Revenue</td>
              <td className="px-3 py-2 text-right num">{formatRupee(netRevenue, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs">100.0%</td>
            </tr>

            <tr className="border-t border-line/40">
              <td className="px-3 py-2">COGS (Cost of Goods Sold)</td>
              <td className="px-3 py-2 text-right num text-rose-700">&minus; {formatRupee(cogs, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(-cogs, netRevenue)}</td>
            </tr>
            <tr className="border-t-2 border-line/60 bg-emerald-50/30 font-semibold">
              <td className="px-3 py-2">Gross Profit</td>
              <td className={'px-3 py-2 text-right num ' + (grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700')}>
                {formatRupee(grossProfit, { decimals: 0 })}
              </td>
              <td className="px-3 py-2 text-right text-xs">{pct(grossProfit, netRevenue)}</td>
            </tr>

            <tr className="border-t border-line/40">
              <td className="px-3 py-2">Wages</td>
              <td className="px-3 py-2 text-right num text-rose-700">&minus; {formatRupee(wages, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(-wages, netRevenue)}</td>
            </tr>
            <tr className="border-t border-line/40">
              <td className="px-3 py-2">Factory Expenses (expense_entry)</td>
              <td className="px-3 py-2 text-right num text-rose-700">&minus; {formatRupee(factoryExpenses, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(-factoryExpenses, netRevenue)}</td>
            </tr>
            <tr className="border-t border-line/40">
              <td className="px-3 py-2">Bank Entries (EB, loan interest, bank charges, etc.)</td>
              <td className="px-3 py-2 text-right num text-rose-700">&minus; {formatRupee(bankExpenses, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(-bankExpenses, netRevenue)}</td>
            </tr>
            <tr className="border-t border-line/40">
              <td className="px-3 py-2">Other Income (Interest Received)</td>
              <td className="px-3 py-2 text-right num text-emerald-700">+ {formatRupee(bankIncome, { decimals: 0 })}</td>
              <td className="px-3 py-2 text-right text-xs text-ink-soft">{pct(bankIncome, netRevenue)}</td>
            </tr>

            <tr className="border-t-2 border-indigo-300 bg-indigo-50/40 font-bold text-base">
              <td className="px-3 py-3">Net Profit</td>
              <td className={'px-3 py-3 text-right num ' + (netProfit >= 0 ? 'text-emerald-800' : 'text-rose-800')}>
                {formatRupee(netProfit, { decimals: 0 })}
              </td>
              <td className="px-3 py-3 text-right text-xs">{pct(netProfit, netRevenue)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-mute mt-4">
        Period: <strong>{from}</strong> to <strong>{to}</strong>.
        COGS uses each batch&apos;s <em>frozen</em> true cost (computed at the time the batch was finished),
        so historical profit doesn&apos;t shift when overhead is re-calibrated today.
        Balance-sheet items (cash withdrawals, loan principal, GST payment, loan disbursement, cash deposit) are excluded.
      </p>
    </div>
  );
}
