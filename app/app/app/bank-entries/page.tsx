/**
 * /app/bank-entries — Bank Entry list (CORR-ext: Bank Journal).
 *
 * One row per bank_entry — non-party bank transactions (EB bill, loan
 * EMI, cash withdrawal, interest received, etc.). The list is the
 * working register for the operator and feeds into:
 *   1. LOOMS Calibration weekly expense auto-fill.
 *   2. P&L period-expense / income / balance-sheet split (via
 *      bank_category.pl_treatment).
 *
 * Filters via querystring:
 *   ?direction=in | out
 *   ?category=<id>
 *   ?from=YYYY-MM-DD
 *   ?to=YYYY-MM-DD
 *   ?pl=expense | income | balance_sheet
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, ArrowDownCircle, ArrowUpCircle, Pencil } from 'lucide-react';
import { formatRupee } from '@/lib/utils';

export const metadata = { title: 'Bank Entries' };
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    direction?: string;
    category?: string;
    from?: string;
    to?: string;
    pl?: string;
  }>;
}

interface BankEntryRow {
  id: number;
  entry_no: string;
  entry_date: string;
  direction: 'in' | 'out';
  amount: number | string;
  bank_name: string | null;
  other_name: string | null;
  category_code: string;
  category_name: string;
  pl_treatment: 'expense' | 'income' | 'balance_sheet';
  mode: string;
  reference: string | null;
  notes: string | null;
  status: string;
}

interface CategoryOpt {
  id: number;
  code: string;
  name: string;
}

function fmtDate(s: string | null): string {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2, '0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

const PL_PILL: Record<BankEntryRow['pl_treatment'], { label: string; cls: string }> = {
  expense:       { label: 'Period Expense', cls: 'bg-rose-50 text-rose-700' },
  income:        { label: 'Period Income',  cls: 'bg-emerald-50 text-emerald-700' },
  balance_sheet: { label: 'Balance Sheet',  cls: 'bg-slate-100 text-slate-700' },
};

export default async function BankEntriesListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const directionFilter = (sp.direction === 'in' || sp.direction === 'out') ? sp.direction : null;
  const categoryFilter  = sp.category && /^\d+$/.test(sp.category) ? Number(sp.category) : null;
  const fromDate        = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : null;
  const toDate          = sp.to   && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)   ? sp.to   : null;
  const plFilter        = (sp.pl === 'expense' || sp.pl === 'income' || sp.pl === 'balance_sheet') ? sp.pl : null;

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  let q = sb.from('v_bank_entry')
    .select('id, entry_no, entry_date, direction, amount, bank_name, other_name, category_code, category_name, pl_treatment, mode, reference, notes, status')
    .eq('status', 'active')
    .order('entry_date', { ascending: false })
    .order('id', { ascending: false })
    .limit(200);
  if (directionFilter) q = q.eq('direction', directionFilter);
  if (categoryFilter !== null) q = q.eq('category_id', categoryFilter);
  if (fromDate) q = q.gte('entry_date', fromDate);
  if (toDate)   q = q.lte('entry_date', toDate);
  if (plFilter) q = q.eq('pl_treatment', plFilter);
  const { data, error } = await q;
  const rows = (data ?? []) as BankEntryRow[];

  const { data: cats } = await sb
    .from('bank_category')
    .select('id, code, name, display_order')
    .eq('active', true)
    .order('display_order');
  const categoryOptions = (cats ?? []) as CategoryOpt[];

  // KPI totals
  const inTotal  = rows.filter((r) => r.direction === 'in').reduce((s, r) => s + Number(r.amount), 0);
  const outTotal = rows.filter((r) => r.direction === 'out').reduce((s, r) => s + Number(r.amount), 0);
  const expenseTotal = rows.filter((r) => r.pl_treatment === 'expense').reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div>
      <PageHeader
        title="Bank Entries"
        subtitle="Non-party bank transactions: EB, loan EMI, interest, cash withdrawals, GST payments. Feeds LOOMS Calibration + P&L."
        actions={
          <Link href="/app/bank-entries/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Bank Entry
          </Link>
        }
      />

      {/* Filters */}
      <form action="/app/bank-entries" method="get" className="card p-3 mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">Direction</span>
          <select name="direction" defaultValue={directionFilter ?? ''} className="input py-1 text-xs">
            <option value="">Both</option>
            <option value="in">In (received)</option>
            <option value="out">Out (paid)</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">Category</span>
          <select name="category" defaultValue={categoryFilter !== null ? String(categoryFilter) : ''} className="input py-1 text-xs min-w-[180px]">
            <option value="">All categories</option>
            {categoryOptions.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">P&amp;L treatment</span>
          <select name="pl" defaultValue={plFilter ?? ''} className="input py-1 text-xs">
            <option value="">All</option>
            <option value="expense">Period Expense</option>
            <option value="income">Period Income</option>
            <option value="balance_sheet">Balance Sheet only</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">From</span>
          <input name="from" type="date" defaultValue={fromDate ?? ''} className="input py-1 text-xs" />
        </label>
        <label className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-ink-mute">To</span>
          <input name="to" type="date" defaultValue={toDate ?? ''} className="input py-1 text-xs" />
        </label>
        <button type="submit" className="btn-secondary text-xs py-1 px-3">Apply</button>
        {(directionFilter || categoryFilter || fromDate || toDate || plFilter) && (
          <Link href="/app/bank-entries" className="text-xs text-ink-mute hover:text-ink underline self-center">
            Clear
          </Link>
        )}
      </form>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Rows shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute flex items-center gap-1">
            <ArrowDownCircle className="w-3 h-3 text-emerald-600" /> Inflow
          </div>
          <div className="num text-xl font-bold text-emerald-700">{formatRupee(inTotal, { compact: true })}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute flex items-center gap-1">
            <ArrowUpCircle className="w-3 h-3 text-rose-600" /> Outflow
          </div>
          <div className="num text-xl font-bold text-rose-700">{formatRupee(outTotal, { compact: true })}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">P&amp;L expense total</div>
          <div className="num text-xl font-bold text-rose-700">{formatRupee(expenseTotal, { compact: true })}</div>
        </div>
      </div>

      {error && (
        <div className="card p-3 mb-4 text-err text-sm">Could not load bank entries: {error.message}</div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="text-left  px-3 py-3">Entry No</th>
              <th className="text-left  px-3 py-3">Date</th>
              <th className="text-left  px-3 py-3">Dir</th>
              <th className="text-left  px-3 py-3">Bank</th>
              <th className="text-left  px-3 py-3">Category</th>
              <th className="text-left  px-3 py-3">Other Ledger</th>
              <th className="text-right px-3 py-3">Amount</th>
              <th className="text-left  px-3 py-3">Mode · Ref</th>
              <th className="text-left  px-3 py-3">P&amp;L</th>
              <th className="text-right px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-ink-soft">
                  No bank entries match these filters.{' '}
                  <Link href="/app/bank-entries/new" className="text-indigo-700 font-semibold underline">Record the first one &rarr;</Link>
                </td>
              </tr>
            ) : rows.map((r) => {
              const pl = PL_PILL[r.pl_treatment];
              return (
                <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-3 py-2 font-mono text-xs">{r.entry_no}</td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{fmtDate(r.entry_date)}</td>
                  <td className="px-3 py-2">
                    {r.direction === 'in'
                      ? <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold"><ArrowDownCircle className="w-3 h-3" /> IN</span>
                      : <span className="inline-flex items-center gap-1 text-rose-700 text-xs font-semibold"><ArrowUpCircle className="w-3 h-3" /> OUT</span>}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.bank_name ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">
                    <div className="font-semibold">{r.category_name}</div>
                    <div className="text-[10px] text-ink-mute font-mono">{r.category_code}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-soft">{r.other_name ?? '—'}</td>
                  <td className={'px-3 py-2 text-right num font-semibold ' + (r.direction === 'in' ? 'text-emerald-700' : 'text-rose-700')}>
                    {formatRupee(r.amount, { decimals: 2 })}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <div className="uppercase">{r.mode}</div>
                    {r.reference && <div className="text-[10px] text-ink-mute font-mono">{r.reference}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`pill ${pl.cls} text-[11px]`}>{pl.label}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/app/bank-entries/${r.id}`} className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex" title="Edit">
                      <Pencil className="w-4 h-4" />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-mute mt-3">
        Categories tagged <strong>Period Expense</strong> reduce profit on the P&amp;L; <strong>Period Income</strong> adds to it; <strong>Balance Sheet</strong> items (cash withdrawal, loan principal, GST payment) move money between accounts only.
      </p>
    </div>
  );
}
