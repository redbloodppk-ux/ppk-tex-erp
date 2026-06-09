/**
 * Cash-flow Snapshot Report (CORR-R7)
 *
 * Single-page money-pulse for the owner. Combines two slices:
 *
 *   1) Money already moved
 *      - In  (customer payments received)  for 7d / 30d / 90d
 *      - Out (vendor / mill payouts)       for 7d / 30d / 90d
 *      - Net (in - out) per window
 *
 *   2) Money still moving (open invoice balances)
 *      - Receivables due in next 7d / 30d + already overdue
 *      - Payables    due in next 7d / 30d + already overdue
 *
 * Plus a 90-day ledger of recent payments (party-resolved) so we
 * can scan the last few weeks of cash activity in one place.
 *
 * Sources: v_cashflow_snapshot (single row), v_cashflow_recent.
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import type { ExcelColumn } from '@/lib/xlsx';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  Clock,
  AlertTriangle,
} from 'lucide-react';

export const metadata = { title: 'Cash-flow Snapshot' };
export const dynamic = 'force-dynamic';

type Window = '7' | '30' | '90';

interface SnapshotRow {
  in_7d: number | null;
  in_30d: number | null;
  in_90d: number | null;
  out_7d: number | null;
  out_30d: number | null;
  out_90d: number | null;
  net_7d: number | null;
  net_30d: number | null;
  net_90d: number | null;
  in_count_30d: number | null;
  out_count_30d: number | null;
  last_payment_date: string | null;
  in_due_7d: number | null;
  in_due_30d: number | null;
  in_overdue: number | null;
  out_due_7d: number | null;
  out_due_30d: number | null;
  out_overdue: number | null;
  net_due_7d: number | null;
  net_due_30d: number | null;
}

// Merged shape — covers both payment rows and bank_entry rows. After
// migration 134 the view exposes generic column names (source_id /
// doc_no / event_date) so the page treats both feeds uniformly.
interface RecentRow {
  source_id: number | null;
  source_kind: 'payment' | 'bank_entry' | null;
  doc_no: string | null;
  event_date: string | null;
  direction: 'in' | 'out' | null;
  amount: number | null;
  mode: string | null;
  reference: string | null;
  party_name: string | null;
  party_code: string | null;
  party_kind: string | null;
  invoice_no: string | null;
  category_code: string | null;
  category_name: string | null;
  days_ago: number | null;
}

interface SearchParams {
  window?: string;
  direction?: string;
}

const RUPEE = '\u20B9';

function fmtRupees(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${RUPEE}${abs.toLocaleString('en-IN', {
    maximumFractionDigits: 0,
  })}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  try {
    return new Date(s).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch {
    return s;
  }
}

function parseWindow(s: string | undefined): Window {
  if (s === '7' || s === '90') return s;
  return '30';
}

function parseDirection(s: string | undefined): 'all' | 'in' | 'out' {
  if (s === 'in' || s === 'out') return s;
  return 'all';
}

export default async function CashflowPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const win = parseWindow(params.window);
  const dirFilter = parseDirection(params.direction);

  const supabase = await createClient();

  const [snapshotRes, recentRes] = await Promise.all([
    supabase.from('v_cashflow_snapshot').select('*').maybeSingle(),
    supabase
      .from('v_cashflow_recent')
      .select('*')
      .order('event_date', { ascending: false })
      .limit(50),
  ]);

  if (snapshotRes.error) {
    throw new Error(
      `Failed to load cash-flow snapshot: ${snapshotRes.error.message}`
    );
  }
  if (recentRes.error) {
    throw new Error(
      `Failed to load recent payments: ${recentRes.error.message}`
    );
  }

  const snap: SnapshotRow | null = snapshotRes.data ?? null;
  // Cast via unknown — the generated database.types.ts still has the
  // pre-migration-134 column names (payment_id / payment_no /
  // payment_date). The view now exposes source_id / source_kind /
  // doc_no / event_date / category_*. Until typegen is re-run, the
  // generated type doesn't overlap our hand-written RecentRow.
  const recent: RecentRow[] = (recentRes.data ?? []) as unknown as RecentRow[];

  const recentFiltered = recent.filter(r =>
    dirFilter === 'all' ? true : r.direction === dirFilter
  );

  const inAmt = snap ? Number(snap[`in_${win}d` as keyof SnapshotRow] ?? 0) : 0;
  const outAmt = snap
    ? Number(snap[`out_${win}d` as keyof SnapshotRow] ?? 0)
    : 0;
  const netAmt = snap
    ? Number(snap[`net_${win}d` as keyof SnapshotRow] ?? 0)
    : 0;

  /* Excel export — the recent-cashflow ledger as currently filtered on screen */
  const exportColumns: ExcelColumn[] = [
    { key: 'event_date', label: 'Date', type: 'date', width: 13 },
    { key: 'source_kind', label: 'Source', type: 'text', width: 12 },
    { key: 'direction', label: 'Direction', type: 'text', width: 11 },
    { key: 'party_name', label: 'Party / Bank', type: 'text', width: 26 },
    { key: 'party_code', label: 'Code', type: 'text', width: 13 },
    { key: 'category_name', label: 'Category', type: 'text', width: 22 },
    { key: 'amount', label: 'Amount', type: 'rupee', width: 14, total: true },
    { key: 'mode', label: 'Mode', type: 'text', width: 12 },
    { key: 'reference', label: 'Reference', type: 'text', width: 18 },
    { key: 'invoice_no', label: 'Invoice', type: 'text', width: 16 },
  ];
  const exportRows = recentFiltered.map((r) => ({
    event_date: r.event_date ?? '',
    source_kind: r.source_kind === 'bank_entry' ? 'Bank Entry' : 'Payment',
    direction: r.direction === 'in' ? 'In' : r.direction === 'out' ? 'Out' : '',
    party_name: r.party_name ?? '',
    party_code: r.party_code ?? '',
    category_name: r.category_name ?? '',
    amount: Number(r.amount ?? 0),
    mode: r.mode ?? '',
    reference: r.reference ?? '',
    invoice_no: r.invoice_no ?? '',
  }));

  return (
    <div>
      <PageHeader
        title="Cash-flow Snapshot"
        subtitle="Money in vs out for the recent past, plus what's coming due on both sides. All amounts in INR."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Cash-flow Snapshot' },
        ]}
        actions={
          <ExcelExportButton
            filename="cashflow-recent-payments"
            sheetName="Recent Payments"
            title="Cash-flow — Recent Payments (last 90 days)"
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      <section className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Payments — last {win} days</h2>
          <WindowSwitcher current={win} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Kpi
            icon={<ArrowDownCircle className="w-4 h-4 text-emerald-600" />}
            label="Money in"
            value={fmtRupees(inAmt)}
            sub={`${snap?.in_count_30d ?? 0} customer payments (30d)`}
          />
          <Kpi
            icon={<ArrowUpCircle className="w-4 h-4 text-rose-500" />}
            label="Money out"
            value={fmtRupees(outAmt)}
            sub={`${snap?.out_count_30d ?? 0} vendor payouts (30d)`}
          />
          <Kpi
            icon={<Wallet className="w-4 h-4 text-ink-mute" />}
            label="Net"
            value={fmtRupees(netAmt)}
            sub={netAmt >= 0 ? 'In your favour' : 'Outflow heavier'}
            tone={netAmt >= 0 ? 'ok' : 'warn'}
          />
        </div>
        <p className="text-xs text-ink-mute mt-3">
          Last payment recorded:{' '}
          <span className="text-ink-soft">
            {fmtDate(snap?.last_payment_date)}
          </span>
        </p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <DuesCard
          title="Receivables — coming in"
          tint="emerald"
          due7={snap?.in_due_7d ?? 0}
          due30={snap?.in_due_30d ?? 0}
          overdue={snap?.in_overdue ?? 0}
          subtitle="From customers, open invoices, balance > 0."
        />
        <DuesCard
          title="Payables — going out"
          tint="rose"
          due7={snap?.out_due_7d ?? 0}
          due30={snap?.out_due_30d ?? 0}
          overdue={snap?.out_overdue ?? 0}
          subtitle="To vendors, open bills, balance > 0."
        />
      </div>

      <section className="card p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Projected net (open dues)</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            label="Next 7 days"
            value={fmtRupees(snap?.net_due_7d ?? 0)}
            sub="Receivables − payables due in 7d"
            tone={(snap?.net_due_7d ?? 0) >= 0 ? 'ok' : 'warn'}
          />
          <Kpi
            label="Next 30 days"
            value={fmtRupees(snap?.net_due_30d ?? 0)}
            sub="Receivables − payables due in 30d"
            tone={(snap?.net_due_30d ?? 0) >= 0 ? 'ok' : 'warn'}
          />
        </div>
      </section>

      <section className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-cloud/60">
          <div>
            <h2 className="font-semibold">Recent payments (last 90 days)</h2>
            <p className="text-xs text-ink-mute mt-0.5">
              {recentFiltered.length} of {recent.length} shown · party resolved
              from customer / vendor / mill
            </p>
          </div>
          <DirectionFilter current={dirFilter} window={win} />
        </div>
        {recentFiltered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-ink-mute">
            No payments in the last 90 days
            {dirFilter !== 'all' ? ` for "${dirFilter}"` : ''}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-cloud/40 text-ink-soft">
                <tr>
                  <Th>Date</Th>
                  <Th>Source</Th>
                  <Th>Direction</Th>
                  <Th>Party / Bank</Th>
                  <Th>Category</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Mode</Th>
                  <Th>Reference</Th>
                  <Th>Invoice</Th>
                </tr>
              </thead>
              <tbody>
                {recentFiltered.map(r => (
                  <tr
                    key={`${r.source_kind ?? 'x'}-${r.source_id ?? `${r.doc_no}-${r.event_date}`}`}
                    className="border-t border-cloud/40"
                  >
                    <Td>
                      <div>{fmtDate(r.event_date)}</div>
                      <div className="text-xs text-ink-mute">
                        {r.days_ago != null ? `${r.days_ago}d ago` : ''}
                      </div>
                    </Td>
                    <Td className="text-xs">
                      <span className={'inline-flex items-center px-1.5 py-0.5 rounded ' +
                        (r.source_kind === 'bank_entry'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-indigo-50 text-indigo-700')}>
                        {r.source_kind === 'bank_entry' ? 'Bank' : 'Pmt'}
                      </span>
                    </Td>
                    <Td>
                      <DirectionBadge dir={r.direction} />
                    </Td>
                    <Td>
                      <div className="font-medium">{r.party_name ?? '—'}</div>
                      <div className="text-xs text-ink-mute">
                        {[r.party_code, r.party_kind]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    </Td>
                    <Td className="text-ink-soft text-xs">
                      {r.category_name ?? (r.source_kind === 'payment' ? 'Party payment' : '—')}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">
                      {fmtRupees(r.amount)}
                    </Td>
                    <Td className="text-ink-soft">{r.mode ?? '—'}</Td>
                    <Td className="text-ink-soft">{r.reference ?? '—'}</Td>
                    <Td className="text-ink-soft">{r.invoice_no ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

interface KpiProps {
  icon?: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: 'ok' | 'warn' | 'danger' | '';
}

function Kpi({ icon, label, value, sub, tone = '' }: KpiProps) {
  const valueClass =
    tone === 'ok'
      ? 'text-emerald-700'
      : tone === 'warn'
      ? 'text-amber-700'
      : tone === 'danger'
      ? 'text-rose-700'
      : 'text-ink';
  return (
    <div className="rounded-lg border border-cloud/60 p-3">
      <div className="flex items-center gap-1.5 text-xs text-ink-mute">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-xl font-semibold tabular-nums mt-1 ${valueClass}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-mute mt-1">{sub}</div>}
    </div>
  );
}

interface DuesCardProps {
  title: string;
  subtitle: string;
  tint: 'emerald' | 'rose';
  due7: number;
  due30: number;
  overdue: number;
}

function DuesCard({ title, subtitle, tint, due7, due30, overdue }: DuesCardProps) {
  const headerClass =
    tint === 'emerald' ? 'text-emerald-700' : 'text-rose-700';
  const Icon = tint === 'emerald' ? ArrowDownCircle : ArrowUpCircle;
  return (
    <section className="card p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className={`font-semibold ${headerClass} flex items-center gap-2`}>
            <Icon className="w-4 h-4" />
            {title}
          </h2>
          <p className="text-xs text-ink-mute mt-1">{subtitle}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <DueCell label="Due 7d" amount={due7} icon={<Clock className="w-3.5 h-3.5" />} />
        <DueCell label="Due 30d" amount={due30} icon={<Clock className="w-3.5 h-3.5" />} />
        <DueCell
          label="Overdue"
          amount={overdue}
          tone={overdue > 0 ? 'danger' : ''}
          icon={<AlertTriangle className="w-3.5 h-3.5" />}
        />
      </div>
    </section>
  );
}

interface DueCellProps {
  label: string;
  amount: number;
  tone?: 'danger' | '';
  icon?: React.ReactNode;
}

function DueCell({ label, amount, tone = '', icon }: DueCellProps) {
  const valueClass = tone === 'danger' ? 'text-rose-700' : 'text-ink';
  return (
    <div className="rounded border border-cloud/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-xs text-ink-mute">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`font-semibold tabular-nums mt-0.5 ${valueClass}`}>
        {fmtRupees(amount)}
      </div>
    </div>
  );
}

function DirectionBadge({ dir }: { dir: 'in' | 'out' | null }) {
  if (dir === 'in') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
        <ArrowDownCircle className="w-3 h-3" />
        In
      </span>
    );
  }
  if (dir === 'out') {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-rose-50 text-rose-700">
        <ArrowUpCircle className="w-3 h-3" />
        Out
      </span>
    );
  }
  return <span className="text-xs text-ink-mute">—</span>;
}

function WindowSwitcher({ current }: { current: Window }) {
  const opts: Array<{ k: Window; label: string }> = [
    { k: '7', label: '7d' },
    { k: '30', label: '30d' },
    { k: '90', label: '90d' },
  ];
  return (
    <form method="get" className="flex items-center gap-1">
      {opts.map(o => (
        <button
          key={o.k}
          type="submit"
          name="window"
          value={o.k}
          className={`text-xs px-2.5 py-1 rounded border ${
            current === o.k
              ? 'bg-ink text-paper border-ink'
              : 'bg-paper text-ink-soft border-cloud/60 hover:bg-cloud/30'
          }`}
        >
          {o.label}
        </button>
      ))}
    </form>
  );
}

function DirectionFilter({
  current,
  window: win,
}: {
  current: 'all' | 'in' | 'out';
  window: Window;
}) {
  const opts: Array<{ k: 'all' | 'in' | 'out'; label: string }> = [
    { k: 'all', label: 'All' },
    { k: 'in', label: 'In' },
    { k: 'out', label: 'Out' },
  ];
  return (
    <form method="get" className="flex items-center gap-1">
      <input type="hidden" name="window" value={win} />
      {opts.map(o => (
        <button
          key={o.k}
          type="submit"
          name="direction"
          value={o.k}
          className={`text-xs px-2.5 py-1 rounded border ${
            current === o.k
              ? 'bg-ink text-paper border-ink'
              : 'bg-paper text-ink-soft border-cloud/60 hover:bg-cloud/30'
          }`}
        >
          {o.label}
        </button>
      ))}
    </form>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`px-3 py-2 text-left font-medium text-xs uppercase tracking-wide ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-top ${className}`}>{children}</td>;
}
