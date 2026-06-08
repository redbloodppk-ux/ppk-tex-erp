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

interface PnlSplitRow {
  period_from: string;
  period_to: string;
  own_metres: number | string;
  jobwork_metres: number | string;
  total_metres: number | string;
  own_share: number | string;
  jw_share: number | string;

  revenue_own: number | string;          revenue_jobwork: number | string;          revenue_combined: number | string;
  credit_notes_own: number | string;     credit_notes_jobwork: number | string;     credit_notes_combined: number | string;
  cogs_own: number | string;             cogs_jobwork: number | string;             cogs_combined: number | string;
  gross_profit_own: number | string;     gross_profit_jobwork: number | string;     gross_profit_combined: number | string;
  wages_own: number | string;            wages_jobwork: number | string;            wages_combined: number | string;
  factory_expenses_own: number | string; factory_expenses_jobwork: number | string; factory_expenses_combined: number | string;
  bank_expenses_own: number | string;    bank_expenses_jobwork: number | string;    bank_expenses_combined: number | string;
  bank_income_own: number | string;      bank_income_jobwork: number | string;      bank_income_combined: number | string;
  period_costs_own: number | string;     period_costs_jobwork: number | string;     period_costs_combined: number | string;
  net_profit_own: number | string;       net_profit_jobwork: number | string;       net_profit_combined: number | string;
}

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; preset?: string; view?: string }>;
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
  const view: 'combined' | 'split' = sp.view === 'split' ? 'split' : 'combined';
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

  // Combined view always loads the existing function so today's output
  // is unchanged. Split view ALSO loads it so the Combined-mode render
  // (still wired to `row`) has data if the user flips back without
  // reloading.
  const { data: rows, error } = await sb.rpc('fn_period_pnl', { p_from: from, p_to: to });
  const row: PnlRow | null = Array.isArray(rows) ? (rows[0] ?? null) : (rows ?? null);

  let splitRow: PnlSplitRow | null = null;
  let splitError: { message: string } | null = null;
  if (view === 'split') {
    const res = await sb.rpc('fn_period_pnl_split', { p_from: from, p_to: to });
    splitRow = Array.isArray(res.data) ? (res.data[0] ?? null) : (res.data ?? null);
    splitError = res.error ?? null;
  }

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

  // Build URLs that preserve the active date/preset while flipping the
  // view. Used by both the toggle pill links above the form and the
  // Quick preset shortcuts below.
  const baseParams = new URLSearchParams();
  if (sp.from)   baseParams.set('from',   sp.from);
  if (sp.to)     baseParams.set('to',     sp.to);
  if (sp.preset) baseParams.set('preset', sp.preset);
  const linkFor = (v: 'combined' | 'split'): string => {
    const qs = new URLSearchParams(baseParams);
    qs.set('view', v);
    return `/app/reports/pnl?${qs.toString()}`;
  };

  return (
    <div>
      <PageHeader
        title="Period Profit & Loss"
        subtitle="Revenue minus COGS, period expenses, plus bank income. Balance-sheet items (cash withdrawals, loan principal, GST payment) are excluded so profit isn't double-counted."
      />

      {/* View toggle — Combined keeps the existing single-column report.
          Split shows a three-column own / jobwork / combined view. */}
      <div className="mb-3 flex items-center gap-1">
        <Link
          href={linkFor('combined')}
          className={
            'px-3 py-1.5 rounded-l-md text-xs font-semibold border border-line ' +
            (view === 'combined' ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
          }
        >
          Combined
        </Link>
        <Link
          href={linkFor('split')}
          className={
            'px-3 py-1.5 rounded-r-md text-xs font-semibold border border-line -ml-px ' +
            (view === 'split' ? 'bg-ink text-white border-ink' : 'bg-paper text-ink-soft hover:bg-haze')
          }
        >
          Split (Own / Jobwork)
        </Link>
      </div>

      {/* Period picker */}
      <form action="/app/reports/pnl" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view} />
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
          <Link href={`/app/reports/pnl?preset=this_month&view=${view}`}   className="text-indigo-700 underline">This month</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/pnl?preset=last_month&view=${view}`}   className="text-indigo-700 underline">Last month</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/pnl?preset=this_quarter&view=${view}`} className="text-indigo-700 underline">Quarter</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/pnl?preset=fy_to_date&view=${view}`}   className="text-indigo-700 underline">FY-to-date</Link>
          <span className="text-ink-mute">·</span>
          <Link href={`/app/reports/pnl?preset=last_30d&view=${view}`}     className="text-indigo-700 underline">Last 30d</Link>
        </div>
      </form>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load P&L: {error.message}</div>
      )}
      {view === 'split' && splitError && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load Split P&L: {splitError.message}</div>
      )}

      {view === 'combined' && (<>
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
      </>)}

      {view === 'split' && (() => {
        // ── Split (Own / Jobwork / Combined) view ──
        // Reads fn_period_pnl_split for the same period and shows three
        // columns plus an allocation footnote. Shared period costs are
        // pre-split inside the SQL by the metre ratio (own_metres vs
        // jobwork_metres) so the page stays a thin renderer.
        const ownMetres = num(splitRow?.own_metres);
        const jwMetres  = num(splitRow?.jobwork_metres);
        const totalMetres = ownMetres + jwMetres;
        const ownShare = num(splitRow?.own_share);
        const jwShare  = num(splitRow?.jw_share);

        const revOwn = num(splitRow?.revenue_own);
        const revJw  = num(splitRow?.revenue_jobwork);
        const revCom = num(splitRow?.revenue_combined);
        const cnOwn  = num(splitRow?.credit_notes_own);
        const cnCom  = num(splitRow?.credit_notes_combined);
        const cogsOwn = num(splitRow?.cogs_own);
        const cogsCom = num(splitRow?.cogs_combined);
        const gpOwn  = num(splitRow?.gross_profit_own);
        const gpJw   = num(splitRow?.gross_profit_jobwork);
        const gpCom  = num(splitRow?.gross_profit_combined);
        const wagesOwn = num(splitRow?.wages_own);
        const wagesJw  = num(splitRow?.wages_jobwork);
        const wagesCom = num(splitRow?.wages_combined);
        const fxOwn = num(splitRow?.factory_expenses_own);
        const fxJw  = num(splitRow?.factory_expenses_jobwork);
        const fxCom = num(splitRow?.factory_expenses_combined);
        const bxOwn = num(splitRow?.bank_expenses_own);
        const bxJw  = num(splitRow?.bank_expenses_jobwork);
        const bxCom = num(splitRow?.bank_expenses_combined);
        const biOwn = num(splitRow?.bank_income_own);
        const biCom = num(splitRow?.bank_income_combined);
        const pcOwn = num(splitRow?.period_costs_own);
        const pcJw  = num(splitRow?.period_costs_jobwork);
        const pcCom = num(splitRow?.period_costs_combined);
        const npOwn = num(splitRow?.net_profit_own);
        const npJw  = num(splitRow?.net_profit_jobwork);
        const npCom = num(splitRow?.net_profit_combined);

        const netRevOwn = revOwn - cnOwn;
        const netRevJw  = revJw;
        const netRevCom = revCom - cnCom;

        const fmt = (n: number): string => formatRupee(n, { decimals: 0 });
        const cls = (n: number): string => (n >= 0 ? 'text-emerald-700' : 'text-rose-700');

        return (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="card p-3 border-emerald-200">
                <div className="text-[11px] uppercase tracking-wide text-ink-mute">Own Production · Net Profit</div>
                <div className={'num text-xl font-extrabold ' + cls(npOwn)}>{fmt(npOwn)}</div>
                <div className="text-[10px] text-ink-mute">Margin: {pct(npOwn, netRevOwn)}</div>
              </div>
              <div className="card p-3 border-amber-200">
                <div className="text-[11px] uppercase tracking-wide text-ink-mute">Job Work · Net Profit</div>
                <div className={'num text-xl font-extrabold ' + cls(npJw)}>{fmt(npJw)}</div>
                <div className="text-[10px] text-ink-mute">Margin: {pct(npJw, netRevJw)}</div>
              </div>
              <div className="card p-3 border-2 border-indigo-300">
                <div className="text-[11px] uppercase tracking-wide text-indigo-700 font-semibold">Combined · Net Profit</div>
                <div className={'num text-2xl font-extrabold ' + cls(npCom)}>{fmt(npCom)}</div>
                <div className="text-[10px] text-ink-mute">Margin: {pct(npCom, netRevCom)}</div>
              </div>
            </div>

            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="text-left  px-3 py-3">Line</th>
                    <th className="text-right px-3 py-3">Own Production</th>
                    <th className="text-right px-3 py-3">Job Work</th>
                    <th className="text-right px-3 py-3">Combined</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2 font-semibold">Revenue</td>
                    <td className={'px-3 py-2 text-right num font-semibold ' + cls(revOwn)}>{fmt(revOwn)}</td>
                    <td className={'px-3 py-2 text-right num font-semibold ' + cls(revJw)}>{fmt(revJw)}</td>
                    <td className={'px-3 py-2 text-right num font-semibold ' + cls(revCom)}>{fmt(revCom)}</td>
                  </tr>
                  {cnCom > 0 && (
                    <tr className="border-t border-line/40">
                      <td className="px-3 py-2 pl-6 text-ink-soft">Less: Credit Notes</td>
                      <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cnOwn)}</td>
                      <td className="px-3 py-2 text-right num text-ink-mute">&mdash;</td>
                      <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cnCom)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-line/40 bg-cloud/30 font-semibold">
                    <td className="px-3 py-2">Net Revenue</td>
                    <td className="px-3 py-2 text-right num">{fmt(netRevOwn)}</td>
                    <td className="px-3 py-2 text-right num">{fmt(netRevJw)}</td>
                    <td className="px-3 py-2 text-right num">{fmt(netRevCom)}</td>
                  </tr>

                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2">COGS (Cost of Goods Sold)</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cogsOwn)}</td>
                    <td className="px-3 py-2 text-right num text-ink-mute">&mdash; <span className="text-[10px]">(customer&apos;s yarn)</span></td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(cogsCom)}</td>
                  </tr>
                  <tr className="border-t-2 border-line/60 bg-emerald-50/30 font-semibold">
                    <td className="px-3 py-2">Gross Profit</td>
                    <td className={'px-3 py-2 text-right num ' + cls(gpOwn)}>{fmt(gpOwn)}</td>
                    <td className={'px-3 py-2 text-right num ' + cls(gpJw)}>{fmt(gpJw)}</td>
                    <td className={'px-3 py-2 text-right num ' + cls(gpCom)}>{fmt(gpCom)}</td>
                  </tr>

                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2">Wages</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(wagesOwn)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(wagesJw)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(wagesCom)}</td>
                  </tr>
                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2">Factory Expenses</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(fxOwn)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(fxJw)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(fxCom)}</td>
                  </tr>
                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2">Bank Entries (expense)</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(bxOwn)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(bxJw)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(bxCom)}</td>
                  </tr>
                  <tr className="border-t border-line/40">
                    <td className="px-3 py-2">Other Income (Interest Received)</td>
                    <td className="px-3 py-2 text-right num text-emerald-700">+ {fmt(biOwn)}</td>
                    <td className="px-3 py-2 text-right num text-ink-mute">&mdash;</td>
                    <td className="px-3 py-2 text-right num text-emerald-700">+ {fmt(biCom)}</td>
                  </tr>

                  <tr className="border-t border-line/40 bg-cloud/30 font-semibold">
                    <td className="px-3 py-2">Period Costs</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(pcOwn)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(pcJw)}</td>
                    <td className="px-3 py-2 text-right num text-rose-700">&minus; {fmt(pcCom)}</td>
                  </tr>

                  <tr className="border-t-2 border-indigo-300 bg-indigo-50/40 font-bold text-base">
                    <td className="px-3 py-3">Net Profit</td>
                    <td className={'px-3 py-3 text-right num ' + cls(npOwn)}>{fmt(npOwn)}</td>
                    <td className={'px-3 py-3 text-right num ' + cls(npJw)}>{fmt(npJw)}</td>
                    <td className={'px-3 py-3 text-right num ' + cls(npCom)}>{fmt(npCom)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="card p-3 mt-3 bg-amber-50/50 border-amber-200 text-[12px] text-ink-soft leading-relaxed">
              <div className="font-semibold text-ink mb-1">Allocation basis</div>
              Period metres: own <strong>{ownMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</strong>
              {' '}+ jobwork <strong>{jwMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</strong>
              {' '}= <strong>{totalMetres.toLocaleString('en-IN', { maximumFractionDigits: 0 })} m</strong>.{' '}
              Shared period costs (Wages, Factory Expenses, Bank Expenses) allocated by metre ratio:
              {' '}own <strong>{(ownShare * 100).toFixed(1)}%</strong>
              {' '}/ jobwork <strong>{(jwShare * 100).toFixed(1)}%</strong>.
              {totalMetres <= 0 && (
                <div className="text-amber-800 mt-2 font-medium">
                  No production this period &mdash; period costs allocated 100% to own-production.
                </div>
              )}
            </div>

            <p className="text-[11px] text-ink-mute mt-4">
              Period: <strong>{from}</strong> to <strong>{to}</strong>.
              COGS uses each batch&apos;s <em>frozen</em> true cost. Jobwork uses customer-owned yarn so jobwork COGS is zero.
              Bank Income and Credit Notes stay on the own side.
              Note: the Combined column here includes <em>both</em> own-production sales AND jobwork labour invoices,
              so it may show a higher total than the single-column Combined report (which currently excludes jobwork labour invoices).
            </p>
          </>
        );
      })()}
    </div>
  );
}
