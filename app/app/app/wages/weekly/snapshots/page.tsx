/**
 * Saved Weekly Wage Snapshots index.
 *
 * Server component. Lists every row in `weekly_wage_summary` (created by
 * the Save snapshot button on the Weekly Wage Summary page) ordered newest
 * first. Each row shows FY label, week number, week range, totals at a
 * glance, and a link back to that week's full summary screen so the user
 * can re-open the saved data in context.
 */
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { formatRupee } from '@/lib/utils';
import { Calendar, ArrowUpRight, Inbox } from 'lucide-react';

export const metadata = { title: 'Saved Weekly Snapshots' };
export const dynamic = 'force-dynamic';

interface SnapshotTotals {
  wages?: number;
  advances?: number;
  adjustments?: number;
  same_day?: number;
  expenses?: number;
  net_cash_out?: number;
}

interface SnapshotRow {
  id: number;
  fy_label: string;
  week_no: number;
  week_start: string;
  week_end: string;
  totals: SnapshotTotals;
  created_at: string;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function prettyDate(iso: string): string {
  const [yStr, mStr, dStr] = iso.split('-');
  const y = Number(yStr);
  const mIdx = Number(mStr) - 1;
  const d = Number(dStr);
  const month = MONTHS[mIdx] ?? '';
  return `${d} ${month} ${y}`;
}

function prettyRange(start: string, end: string): string {
  const [, sm] = start.split('-');
  const [, em, ey] = end.split('-');
  if (sm === em) {
    const [, , sd] = start.split('-');
    const [, , ed] = end.split('-');
    const month = MONTHS[Number(sm) - 1] ?? '';
    return `${Number(sd)} – ${Number(ed)} ${month} ${ey}`;
  }
  return `${prettyDate(start)} – ${prettyDate(end)}`;
}

function prettyDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.getDate();
  const month = MONTHS[d.getMonth()] ?? '';
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hh}:${mm}`;
}

export default async function SnapshotsIndexPage(): Promise<React.ReactElement> {
  const supabase = await createClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rowsRaw, error } = await (supabase as any)
    .from('weekly_wage_summary')
    .select('id, fy_label, week_no, week_start, week_end, totals, created_at')
    .order('week_start', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = (rowsRaw ?? []) as SnapshotRow[];

  return (
    <div>
      <PageHeader
        title="Saved Weekly Snapshots"
        subtitle="Every Weekly Wage Summary you have saved, newest first"
        crumbs={[
          { label: 'Wages', href: '/app/wages' },
          { label: 'Weekly Summary', href: '/app/wages/weekly' },
          { label: 'Snapshots' },
        ]}
      />

      {error ? (
        <div className="card p-4 text-sm text-err">
          Could not load snapshots: {error.message ?? 'unknown error'}
        </div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <Inbox className="w-10 h-10 text-ink-mute mx-auto mb-3" />
          <p className="text-sm font-semibold text-ink mb-1">No saved snapshots yet</p>
          <p className="text-xs text-ink-soft max-w-md mx-auto mb-4">
            Open a Weekly Wage Summary and click <span className="font-semibold">Save snapshot</span> to
            preserve that week's totals here.
          </p>
          <Link
            href="/app/wages/weekly"
            className="btn-secondary inline-flex"
          >
            <Calendar className="w-4 h-4" />
            Go to Weekly Summary
          </Link>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-haze/60 text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left">FY</th>
                  <th className="px-3 py-2 text-left">Week</th>
                  <th className="px-3 py-2 text-left">Range</th>
                  <th className="px-3 py-2 text-right">Wages</th>
                  <th className="px-3 py-2 text-right">Advances</th>
                  <th className="px-3 py-2 text-right">Expenses</th>
                  <th className="px-3 py-2 text-right">Net cash out</th>
                  <th className="px-3 py-2 text-left">Saved</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line hover:bg-haze/30">
                    <td className="px-3 py-2 font-mono text-xs">{r.fy_label}</td>
                    <td className="px-3 py-2 font-semibold">W{String(r.week_no).padStart(2, '0')}</td>
                    <td className="px-3 py-2">{prettyRange(r.week_start, r.week_end)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRupee(r.totals.wages ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRupee(r.totals.advances ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatRupee(r.totals.expenses ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {formatRupee(r.totals.net_cash_out ?? 0)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      {prettyDateTime(r.created_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/app/wages/weekly?week=${r.week_start}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
                      >
                        Open <ArrowUpRight className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 text-xs text-ink-soft border-t border-line">
            Showing {rows.length} {rows.length === 1 ? 'snapshot' : 'snapshots'} (most recent 200).
          </div>
        </div>
      )}
    </div>
  );
}
