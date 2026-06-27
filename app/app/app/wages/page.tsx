/**
 * Wages register (CORR-T4)
 *
 * Server component. Lists wage_entry rows with employee + kind + period
 * + amount. Provides a link to add a new entry. Owner/accounts can write,
 * mill_manager/auditor can read.
 *
 * Each row's amount gets spread across in-house production_batch rows whose
 * production window overlaps period_start..period_end, by the basis set on
 * the employee (metres or loom_shifts). See v_batch_wage_allocation.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { Plus, Pencil } from 'lucide-react';
import { formatRupee } from '@/lib/utils';
import { DeleteWageButton } from './delete-wage-button';
import { WageFilters } from './wage-filters';
import { CardFilter } from '@/app/components/card-filter';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';

export const metadata = { title: 'Wages' };
export const dynamic = 'force-dynamic';

// Columns the list may be sorted by. Anything else falls back to the default.
const SORTABLE_COLUMNS = new Set(['pay_date', 'created_at']);

// Render the entry timestamp as date + 24h time in IST, e.g. "27-Jun-2026 20:18".
function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(d).replace(',', '');
}

type Kind = 'same_day' | 'advance' | 'settlement' | 'adjustment';

interface WageRow {
  id: number;
  pay_date: string;
  period_start: string;
  period_end: string;
  kind: Kind;
  amount: number;
  notes: string | null;
  created_at: string | null;
  employee: { code: string; full_name: string; wage_alloc_basis: string } | null;
}

const KIND_PILL: Record<Kind, string> = {
  same_day:   'bg-sky-50 text-sky-700',
  advance:    'bg-amber-50 text-amber-700',
  settlement: 'bg-emerald-50 text-emerald-700',
  adjustment: 'bg-slate-100 text-slate-600',
};

export default async function WagesPage({
  searchParams,
}: {
  searchParams: Promise<{ emp?: string; from?: string; to?: string; sort?: string; dir?: string }>;
}): Promise<React.ReactElement> {
  const sp = await searchParams;
  const empId = sp.emp != null && /^\d+$/.test(sp.emp) ? Number(sp.emp) : null;
  // Basic ISO-date guard so a malformed param can't break the query.
  const isDate = (s: string | undefined): s is string => s != null && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isDate(sp.from) ? sp.from : null;
  const to = isDate(sp.to) ? sp.to : null;

  // Sort: default newest pay date first. The Pay date and Entered headers are
  // clickable; created_at lets the user order by exact time of data entry.
  const sortKey = sp.sort && SORTABLE_COLUMNS.has(sp.sort) ? sp.sort : 'pay_date';
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc';

  const supabase = await createClient();
  // wage_entry was added in migration 031 — database.types.ts hasn't been
  // regenerated yet, so the supabase-js generic blows up. Cast through any
  // to dodge the "type instantiation is excessively deep" error; the runtime
  // shape is asserted via WageRow below.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('wage_entry')
    .select(`
      id, pay_date, period_start, period_end, kind, amount, notes, created_at,
      employee:employee_id ( code, full_name, wage_alloc_basis )
    `)
    .order(sortKey, { ascending: dir === 'asc' })
    // Stable tiebreaker so equal sort keys keep a deterministic order.
    .order('created_at', { ascending: false })
    .limit(200);

  // Employee filter.
  if (empId != null) query = query.eq('employee_id', empId);
  // Period overlap: keep entries whose work period [period_start,
  // period_end] intersects the chosen [from, to] window. period_start
  // <= to AND period_end >= from.
  if (to != null)   query = query.lte('period_start', to);
  if (from != null) query = query.gte('period_end', from);

  const { data, error } = await query;

  // Employee dropdown options — active employees, name-sorted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: empData } = await (supabase as any)
    .from('employee')
    .select('id, code, full_name')
    .order('full_name', { ascending: true });
  const employees = ((empData ?? []) as Array<{ id: number; code: string; full_name: string }>);

  const rows = (data as unknown as WageRow[]) ?? [];
  const total = rows.reduce((acc, r) => acc + Number(r.amount || 0), 0);

  // Preserve the active filters when a sortable header is clicked.
  const sortParams: Record<string, string | undefined> = {
    emp: empId != null ? String(empId) : undefined,
    from: from ?? undefined,
    to: to ?? undefined,
  };

  return (
    <div>
      <PageHeader
        title="Wages"
        subtitle="Mill wages register. Advances and weekly settlements both live here — each entry is spread across in-house batches by the employee's chosen basis."
        actions={
          <Link href="/app/wages/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Wage Entry
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load wages: {error.message}
        </div>
      )}

      <WageFilters employees={employees} />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Entries shown</div>
          <div className="num text-xl font-bold">{rows.length}</div>
        </div>
        <div className="card p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-mute">Total paid (shown)</div>
          <div className="num text-xl font-bold">{formatRupee(total)}</div>
        </div>
      </div>

      {/* Mobile / PWA: card view. The wages table is wide; on a phone we
          show each entry as a tap-friendly card. Hidden from md up, where
          the full table below takes over. */}
      <CardFilter placeholder="Search wages…">
        {rows.length ? rows.map((r) => (
          <div key={r.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/app/wages/${r.id}`} className="font-semibold text-ink hover:text-indigo break-words">
                  {r.employee?.full_name ?? '—'}
                </Link>
                <div className="font-mono text-[11px] text-ink-mute mt-0.5">{r.employee?.code ?? ''}</div>
              </div>
              <span className={`pill shrink-0 ${KIND_PILL[r.kind]}`}>{r.kind}</span>
            </div>

            <div className="flex items-end justify-between mt-2">
              <div className="text-xs text-ink-soft">
                <div className="num">{r.pay_date}</div>
                <div className="num mt-0.5">{r.period_start} → {r.period_end}</div>
                <div className="mt-0.5 capitalize">
                  Basis: {(r.employee?.wage_alloc_basis ?? 'metres').replace('_', '-')}
                </div>
                <div className="mt-0.5">
                  <span className="text-ink-mute">Entered: </span><span className="num">{fmtDateTime(r.created_at)}</span>
                </div>
              </div>
              <div className="num font-semibold text-base text-right">
                {formatRupee(Number(r.amount))}
              </div>
            </div>
            {r.notes && (
              <div className="text-xs text-ink-soft mt-1">
                <span className="text-ink-mute">Notes: </span>{r.notes}
              </div>
            )}

            <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
              <Link
                href={`/app/wages/${r.id}`}
                className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
                title="Edit this wage entry"
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Link>
              <DeleteWageButton
                id={r.id}
                label={`${r.employee?.full_name ?? ''} ${formatRupee(Number(r.amount))}`.trim()}
              />
            </div>
          </div>
        )) : (
          <div className="card p-6 text-center text-sm text-ink-soft">
            No wage entries yet.{' '}
            <Link href="/app/wages/new" className="text-indigo font-semibold">
              Add the first one →
            </Link>
          </div>
        )}
      </CardFilter>

      <div className="card overflow-x-auto hidden md:block">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <SortableTh column="pay_date" label="Pay date" sort={sortKey} dir={dir} basePath="/app/wages" extraParams={sortParams} className="text-left px-4 py-3" />
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3 hidden md:table-cell">Period</th>
              <th className="text-left px-4 py-3">Kind</th>
              <th className="text-right px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3 hidden lg:table-cell">Basis</th>
              <SortableTh column="created_at" label="Entered" sort={sortKey} dir={dir} basePath="/app/wages" extraParams={sortParams} className="text-left px-4 py-3" />
              <th className="text-left px-4 py-3 hidden xl:table-cell">Notes</th>
              <th className="text-right px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="border-t border-line/40 hover:bg-haze/60">
                <td className="px-4 py-3 num text-xs">{r.pay_date}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.employee?.full_name ?? '—'}</div>
                  <div className="text-[11px] text-ink-mute font-mono">{r.employee?.code ?? ''}</div>
                </td>
                <td className="px-4 py-3 hidden md:table-cell num text-xs text-ink-soft">
                  {r.period_start} → {r.period_end}
                </td>
                <td className="px-4 py-3">
                  <span className={`pill ${KIND_PILL[r.kind]}`}>{r.kind}</span>
                </td>
                <td className="px-4 py-3 text-right num font-semibold">
                  {formatRupee(Number(r.amount))}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell text-xs capitalize">
                  {(r.employee?.wage_alloc_basis ?? 'metres').replace('_', '-')}
                </td>
                <td className="px-4 py-3 num text-xs text-ink-soft whitespace-nowrap">
                  {fmtDateTime(r.created_at)}
                </td>
                <td className="px-4 py-3 hidden xl:table-cell text-xs text-ink-soft">
                  {r.notes ?? '—'}
                </td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5">
                    <Link
                      href={`/app/wages/${r.id}`}
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-haze/60"
                      title="Edit this wage entry"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Link>
                    <DeleteWageButton
                      id={r.id}
                      label={`${r.employee?.full_name ?? ''} ${formatRupee(Number(r.amount))}`.trim()}
                    />
                  </div>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-soft">
                  No wage entries yet.{' '}
                  <Link href="/app/wages/new" className="text-indigo font-semibold">
                    Add the first one →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
