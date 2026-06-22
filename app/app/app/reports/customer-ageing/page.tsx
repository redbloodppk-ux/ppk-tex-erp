/**
 * Customer Ageing Report (CORR-R4)
 *
 * Outstanding receivables per customer, bucketed by invoice age from
 * invoice_date:
 *
 *   • 0-30   — current
 *   • 31-60  — getting old, time to nudge
 *   • 61-90  — chase
 *   • 90+    — collection risk
 *
 * Credit notes net out (they reduce the customer's outstanding).
 * Excludes draft / cancelled / paid invoices. Source: v_customer_ageing.
 *
 * Filters (querystring):
 *   - sort:        oldest | biggest | name        (default: biggest)
 *   - only_overdue: 1 to show only customers with overdue amount > 0
 *   - hide_zero:   1 to hide customers with zero balance
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import { CardFilter } from '@/app/components/card-filter';
import type { ExcelColumn } from '@/lib/xlsx';
import { AlertTriangle, BadgeCheck, Users, Clock } from 'lucide-react';

export const metadata = { title: 'Customer Ageing' };
export const dynamic = 'force-dynamic';

type SortKey = 'oldest' | 'biggest' | 'name';

interface AgeingRow {
  customer_id: number | null;
  code: string | null;
  name: string | null;
  city: string | null;
  state: string | null;
  is_vip: boolean | null;
  payment_terms_days: number | null;
  credit_limit: number | null;
  customer_status: string | null;
  bucket_0_30: number | null;
  bucket_31_60: number | null;
  bucket_61_90: number | null;
  bucket_90_plus: number | null;
  total_outstanding: number | null;
  overdue_amount: number | null;
  open_invoice_count: number | null;
  oldest_age_days: number | null;
  last_invoice_date: string | null;
  last_payment_date: string | null;
  over_credit_limit: boolean | null;
}

interface SearchParams {
  sort?: string;
  only_overdue?: string;
  hide_zero?: string;
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

function fmtDaysSince(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return '—';
  const days = Math.floor(
    (Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days < 0) return '—';
  return `${days}d ago`;
}

function parseSort(s: string | undefined): SortKey {
  if (s === 'oldest' || s === 'name') return s;
  return 'biggest';
}

export default async function CustomerAgeingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const sort = parseSort(sp.sort);
  const onlyOverdue = sp.only_overdue === '1';
  const hideZero = sp.hide_zero === '1';

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('v_customer_ageing')
    .select('*');

  if (error) {
    return (
      <div>
        <PageHeader title="Customer Ageing" />
        <div className="card p-4 text-sm text-red-600">
          Failed to load: {error.message}
        </div>
      </div>
    );
  }

  let rows: AgeingRow[] = (data ?? []) as AgeingRow[];

  if (hideZero) {
    rows = rows.filter(
      (r) => (r.total_outstanding ?? 0) !== 0
    );
  }
  if (onlyOverdue) {
    rows = rows.filter((r) => (r.overdue_amount ?? 0) > 0);
  }

  rows.sort((a, b) => {
    if (sort === 'oldest') {
      return (b.oldest_age_days ?? -1) - (a.oldest_age_days ?? -1);
    }
    if (sort === 'name') {
      return (a.name ?? '').localeCompare(b.name ?? '');
    }
    return (b.total_outstanding ?? 0) - (a.total_outstanding ?? 0);
  });

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += r.total_outstanding ?? 0;
      acc.overdue += r.overdue_amount ?? 0;
      acc.b1 += r.bucket_0_30 ?? 0;
      acc.b2 += r.bucket_31_60 ?? 0;
      acc.b3 += r.bucket_61_90 ?? 0;
      acc.b4 += r.bucket_90_plus ?? 0;
      if ((r.total_outstanding ?? 0) !== 0) acc.withBal += 1;
      if ((r.over_credit_limit ?? false) === true) acc.overLimit += 1;
      acc.oldest = Math.max(acc.oldest, r.oldest_age_days ?? 0);
      return acc;
    },
    {
      total: 0,
      overdue: 0,
      b1: 0,
      b2: 0,
      b3: 0,
      b4: 0,
      withBal: 0,
      overLimit: 0,
      oldest: 0,
    }
  );

  const bucketTotal = totals.b1 + totals.b2 + totals.b3 + totals.b4;
  const pct = (n: number): number =>
    bucketTotal > 0 ? Math.round((n / bucketTotal) * 100) : 0;

  /* Excel export (matches the filtered, sorted rows shown below) */
  const exportColumns: ExcelColumn[] = [
    { key: 'customer', label: 'Customer', type: 'text', width: 26 },
    { key: 'code', label: 'Code', type: 'text', width: 12 },
    { key: 'city', label: 'City', type: 'text', width: 14 },
    { key: 'bucket_0_30', label: '0-30', type: 'rupee', width: 13, total: true },
    { key: 'bucket_31_60', label: '31-60', type: 'rupee', width: 13, total: true },
    { key: 'bucket_61_90', label: '61-90', type: 'rupee', width: 13, total: true },
    { key: 'bucket_90_plus', label: '90+', type: 'rupee', width: 13, total: true },
    { key: 'total_outstanding', label: 'Total', type: 'rupee', width: 14, total: true },
    { key: 'overdue_amount', label: 'Overdue', type: 'rupee', width: 14, total: true },
    { key: 'open_invoice_count', label: 'Open inv', type: 'number', width: 10, total: true },
    { key: 'oldest_age_days', label: 'Oldest (days)', type: 'number', width: 12 },
    { key: 'last_payment_date', label: 'Last paid', type: 'date', width: 13 },
  ];
  const exportRows = rows.map((r) => ({
    customer: r.name ?? '',
    code: r.code ?? '',
    city: r.city ?? '',
    bucket_0_30: Number(r.bucket_0_30 ?? 0),
    bucket_31_60: Number(r.bucket_31_60 ?? 0),
    bucket_61_90: Number(r.bucket_61_90 ?? 0),
    bucket_90_plus: Number(r.bucket_90_plus ?? 0),
    total_outstanding: Number(r.total_outstanding ?? 0),
    overdue_amount: Number(r.overdue_amount ?? 0),
    open_invoice_count: Number(r.open_invoice_count ?? 0),
    oldest_age_days: Number(r.oldest_age_days ?? 0),
    last_payment_date: r.last_payment_date ?? '',
  }));

  return (
    <div>
      <PageHeader
        title="Customer Ageing"
        subtitle="Outstanding receivables bucketed by invoice age. Credit notes net out."
        crumbs={[
          { label: 'Reports', href: '/app/reports' },
          { label: 'Customer Ageing' },
        ]}
        actions={
          <ExcelExportButton
            filename="customer-ageing"
            sheetName="Customer Ageing"
            title="Customer Ageing"
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Kpi
          label="Total receivables"
          value={fmtRupees(totals.total)}
          icon={<Users className="w-4 h-4" />}
        />
        <Kpi
          label="Overdue"
          value={fmtRupees(totals.overdue)}
          tone={totals.overdue > 0 ? 'warn' : 'ok'}
          icon={<Clock className="w-4 h-4" />}
        />
        <Kpi
          label="Customers with balance"
          value={`${totals.withBal}`}
          icon={<BadgeCheck className="w-4 h-4" />}
        />
        <Kpi
          label="Over credit limit"
          value={`${totals.overLimit}`}
          tone={totals.overLimit > 0 ? 'danger' : 'ok'}
          icon={<AlertTriangle className="w-4 h-4" />}
        />
      </div>

      {/* Bucket breakdown bar */}
      {bucketTotal > 0 && (
        <div className="card p-4 mb-4">
          <div className="text-xs text-ink-mute mb-2">
            Ageing buckets ({fmtRupees(bucketTotal)} total)
          </div>
          <div className="flex h-7 rounded overflow-hidden border border-line">
            <BucketSlice
              pct={pct(totals.b1)}
              tone="bg-emerald-400"
              label="0-30"
            />
            <BucketSlice
              pct={pct(totals.b2)}
              tone="bg-amber-300"
              label="31-60"
            />
            <BucketSlice
              pct={pct(totals.b3)}
              tone="bg-orange-400"
              label="61-90"
            />
            <BucketSlice
              pct={pct(totals.b4)}
              tone="bg-red-500"
              label="90+"
            />
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2 text-xs">
            <BucketLegend
              dot="bg-emerald-400"
              label="0-30"
              amt={totals.b1}
              p={pct(totals.b1)}
            />
            <BucketLegend
              dot="bg-amber-300"
              label="31-60"
              amt={totals.b2}
              p={pct(totals.b2)}
            />
            <BucketLegend
              dot="bg-orange-400"
              label="61-90"
              amt={totals.b3}
              p={pct(totals.b3)}
            />
            <BucketLegend
              dot="bg-red-500"
              label="90+"
              amt={totals.b4}
              p={pct(totals.b4)}
            />
          </div>
        </div>
      )}

      {/* Filter form */}
      <form
        method="get"
        className="card p-3 mb-4 flex flex-wrap items-end gap-3 text-sm"
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Sort by</span>
          <select
            name="sort"
            defaultValue={sort}
            className="input min-w-[10rem]"
          >
            <option value="biggest">Biggest balance</option>
            <option value="oldest">Oldest invoice</option>
            <option value="name">Customer name</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="only_overdue"
            value="1"
            defaultChecked={onlyOverdue}
          />
          <span>Only overdue</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="hide_zero"
            value="1"
            defaultChecked={hideZero}
          />
          <span>Hide zero balance</span>
        </label>
        <button type="submit" className="btn">
          Apply
        </button>
      </form>

      {/* Table */}
      {rows.length === 0 ? (
        <div className="card p-6 text-center text-ink-mute text-sm">
          Nothing to show with current filters.
        </div>
      ) : (
        <>
        {/* Mobile / PWA: card view. The ageing table is wide; below md each
            customer becomes a tap-friendly card. */}
        <CardFilter placeholder="Search customers…">
          {rows.map((r) => (
            <div
              key={r.customer_id ?? r.code ?? r.name ?? Math.random()}
              className="card p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold text-ink break-words">
                    {r.name ?? '—'}
                  </div>
                  <div className="text-xs text-ink-mute mt-0.5">
                    {r.code ?? '—'}
                    {r.city ? ` · ${r.city}` : ''}
                    {r.payment_terms_days != null
                      ? ` · ${r.payment_terms_days}d terms`
                      : ''}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {r.is_vip && (
                      <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                        VIP
                      </span>
                    )}
                    {r.over_credit_limit && (
                      <span className="text-[10px] uppercase tracking-wide bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                        Over limit
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total</div>
                  <div className="num font-semibold text-base">{fmtRupees(r.total_outstanding)}</div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-ink-soft mt-2 pt-2 border-t border-line/40">
                <div>0-30: <span className="num">{fmtRupees(r.bucket_0_30)}</span></div>
                <div className={(r.bucket_31_60 ?? 0) > 0 ? 'text-amber-700' : ''}>31-60: <span className="num">{fmtRupees(r.bucket_31_60)}</span></div>
                <div className={(r.bucket_61_90 ?? 0) > 0 ? 'text-amber-700' : ''}>61-90: <span className="num">{fmtRupees(r.bucket_61_90)}</span></div>
                <div className={(r.bucket_90_plus ?? 0) > 0 ? 'text-red-600' : ''}>90+: <span className="num">{fmtRupees(r.bucket_90_plus)}</span></div>
                <div className={(r.overdue_amount ?? 0) > 0 ? 'text-amber-700' : ''}>Overdue: <span className="num">{fmtRupees(r.overdue_amount)}</span></div>
                <div>Open inv: <span className="num">{r.open_invoice_count ?? 0}</span></div>
                <div>Oldest: <span className="num">{r.oldest_age_days != null ? `${r.oldest_age_days}d` : '—'}</span></div>
                {r.last_payment_date ? (
                  <div className="col-span-2">Last paid: {fmtDate(r.last_payment_date)} · {fmtDaysSince(r.last_payment_date)}</div>
                ) : null}
              </div>
            </div>
          ))}
        </CardFilter>

        <div className="card overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-ink-mute border-b border-line">
              <tr>
                <Th>Customer</Th>
                <Th right>0-30</Th>
                <Th right>31-60</Th>
                <Th right>61-90</Th>
                <Th right>90+</Th>
                <Th right>Total</Th>
                <Th right>Overdue</Th>
                <Th right>Inv</Th>
                <Th right>Oldest</Th>
                <Th>Last paid</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.customer_id ?? r.code ?? r.name ?? Math.random()}
                  className="border-b border-line/60"
                >
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {r.name ?? '—'}
                      </span>
                      {r.is_vip && (
                        <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                          VIP
                        </span>
                      )}
                      {r.over_credit_limit && (
                        <span className="text-[10px] uppercase tracking-wide bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                          Over limit
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-mute">
                      {r.code ?? '—'}
                      {r.city ? ` · ${r.city}` : ''}
                      {r.payment_terms_days != null
                        ? ` · ${r.payment_terms_days}d terms`
                        : ''}
                    </div>
                  </td>
                  <Td right>{fmtRupees(r.bucket_0_30)}</Td>
                  <Td right tone={(r.bucket_31_60 ?? 0) > 0 ? 'warn' : ''}>
                    {fmtRupees(r.bucket_31_60)}
                  </Td>
                  <Td right tone={(r.bucket_61_90 ?? 0) > 0 ? 'warn' : ''}>
                    {fmtRupees(r.bucket_61_90)}
                  </Td>
                  <Td
                    right
                    tone={(r.bucket_90_plus ?? 0) > 0 ? 'danger' : ''}
                  >
                    {fmtRupees(r.bucket_90_plus)}
                  </Td>
                  <Td right strong>
                    {fmtRupees(r.total_outstanding)}
                  </Td>
                  <Td
                    right
                    tone={(r.overdue_amount ?? 0) > 0 ? 'warn' : ''}
                  >
                    {fmtRupees(r.overdue_amount)}
                  </Td>
                  <Td right>{r.open_invoice_count ?? 0}</Td>
                  <Td right>
                    {r.oldest_age_days != null
                      ? `${r.oldest_age_days}d`
                      : '—'}
                  </Td>
                  <td className="py-2 px-3 text-xs text-ink-soft whitespace-nowrap">
                    {r.last_payment_date
                      ? `${fmtDate(r.last_payment_date)} · ${fmtDaysSince(r.last_payment_date)}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="font-medium">
              <tr>
                <td className="py-2 px-3">Total</td>
                <Td right>{fmtRupees(totals.b1)}</Td>
                <Td right>{fmtRupees(totals.b2)}</Td>
                <Td right>{fmtRupees(totals.b3)}</Td>
                <Td right>{fmtRupees(totals.b4)}</Td>
                <Td right strong>
                  {fmtRupees(totals.total)}
                </Td>
                <Td right>{fmtRupees(totals.overdue)}</Td>
                <td colSpan={3}></td>
              </tr>
            </tfoot>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

// ---------- small helpers ----------

type Tone = 'ok' | 'warn' | 'danger' | '';

function Kpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: Tone;
  icon?: React.ReactNode;
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'ok'
          ? 'text-emerald-700'
          : 'text-ink';
  return (
    <div className="card p-3">
      <div className="flex items-center gap-2 text-xs text-ink-mute">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-xl font-semibold mt-1 ${toneCls}`}>{value}</div>
    </div>
  );
}

function BucketSlice({
  pct,
  tone,
  label,
}: {
  pct: number;
  tone: string;
  label: string;
}) {
  if (pct <= 0) return null;
  return (
    <div
      className={`${tone} flex items-center justify-center text-[11px] text-white font-medium`}
      style={{ width: `${pct}%` }}
      title={`${label}: ${pct}%`}
    >
      {pct >= 8 ? `${pct}%` : ''}
    </div>
  );
}

function BucketLegend({
  dot,
  label,
  amt,
  p,
}: {
  dot: string;
  label: string;
  amt: number;
  p: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-sm ${dot}`} />
      <span className="text-ink-mute">{label}</span>
      <span className="ml-auto font-medium">{fmtRupees(amt)}</span>
      <span className="text-ink-mute">({p}%)</span>
    </div>
  );
}

function Th({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: boolean;
}) {
  return (
    <th
      className={`py-2 px-3 font-medium ${right ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  strong,
  tone,
}: {
  children: React.ReactNode;
  right?: boolean;
  strong?: boolean;
  tone?: string;
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-red-600'
      : tone === 'warn'
        ? 'text-amber-700'
        : '';
  return (
    <td
      className={`py-2 px-3 whitespace-nowrap tabular-nums ${right ? 'text-right' : 'text-left'} ${strong ? 'font-semibold' : ''} ${toneCls}`}
    >
      {children}
    </td>
  );
}
