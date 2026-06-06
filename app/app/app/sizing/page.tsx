import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';

export const metadata = { title: 'Sizing Jobs' };

// Per-tab whitelists. Each tab queries different columns so they need
// their own allow-lists; the ?sort key from the URL is validated against
// the active tab's whitelist before it reaches PostgREST.
const JOBS_SORTABLE  = new Set(['job_code', 'set_no']);
const BILLS_SORTABLE = new Set(['bill_no', 'bill_date']);

const STATUS_STYLE: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-700',
  sent:       'bg-amber-50 text-amber-700',
  in_process: 'bg-indigo-50 text-indigo-700',
  received:   'bg-emerald-50 text-emerald-700',
  assigned:   'bg-violet-50 text-violet-700',
  done:       'bg-slate-100 text-slate-600',
  cancelled:  'bg-rose-50 text-rose-700',
};

type Tab = 'jobs' | 'bills';

interface PageProps {
  searchParams: Promise<{ tab?: string; sort?: string; dir?: string }>;
}

function fmtDate(s: string | null): string {
  if (!s) return '-';
  const d = new Date(s + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return s;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function fmtMoney(v: unknown): string {
  return Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function SizingListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'bills' ? 'bills' : 'jobs';

  // Pick the right whitelist + fallback for the active tab. The shared
  // ?sort and ?dir params live alongside ?tab; SortableTh preserves tab
  // via extraParams so the active tab survives a re-sort click.
  const allowed = tab === 'jobs' ? JOBS_SORTABLE : BILLS_SORTABLE;
  const fallback = tab === 'jobs' ? 'job_code' : 'bill_date';
  const sort: string = allowed.has(sp.sort ?? '') ? (sp.sort as string) : fallback;
  // bill_date defaults to newest-first; everything else asc unless asked.
  const dir: SortDir = sp.dir === 'asc'
    ? 'asc'
    : sp.dir === 'desc'
      ? 'desc'
      : (sort === 'bill_date' ? 'desc' : 'asc');

  const supabase = await createClient();

  // Pull each job plus the foreign-key labels we want to show. PostgREST
  // resolves the joins for us. Cast to any because the regenerated
  // Supabase types haven't caught up to the yarn_mill_id →
  // yarn_supplier_party_id rename from migration 098 nor the
  // bill_no / bill_date addition from migration 116.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  const jobsRes = tab === 'jobs'
    ? await sb
        .from('sizing_job')
        .select(`
          id, job_code, set_no, status, date_sent, date_received,
          yarn_sent_kg, yarn_used_kg, no_of_paavu,
          sizing_vendor:sizing_ledger_id ( name ),
          yarn_supplier:yarn_supplier_party_id ( name ),
          warp_count:warp_count_id        ( code )
        `)
        .order(sort, { ascending: dir === 'asc' })
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [], error: null };

  // Bills tab — every sizing_job row that has a bill_no captured,
  // ordered newest-bill-first.
  const billsRes = tab === 'bills'
    ? await sb
        .from('sizing_job')
        .select(`
          id, job_code, bill_no, bill_date, status,
          yarn_sent_kg, yarn_used_kg,
          sizing_rate_per_kg, charges_amount, gst_pct, total_amount,
          sizing_vendor:sizing_ledger_id ( name ),
          warp_count:warp_count_id ( code )
        `)
        .not('bill_no', 'is', null)
        .order(sort, { ascending: dir === 'asc', nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [], error: null };

  return (
    <div>
      <PageHeader
        title="Sizing"
        subtitle="Sizing jobs and their bills. Each job records the sizing mill's invoice; charges are billed against Yarn Used (kg)."
        actions={
          <Link href="/app/sizing/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Sizing Job
          </Link>
        }
      />

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-line/60">
        <Link
          href="/app/sizing?tab=jobs"
          className={
            'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
            (tab === 'jobs'
              ? 'border-indigo text-indigo bg-indigo-50/60'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
          }
        >
          Jobs
        </Link>
        <Link
          href="/app/sizing?tab=bills"
          className={
            'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
            (tab === 'bills'
              ? 'border-indigo text-indigo bg-indigo-50/60'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
          }
        >
          Bills
        </Link>
      </div>

      {tab === 'jobs' && (
        <>
          {jobsRes.error && (
            <div className="card p-4 text-sm text-err mb-4">
              Could not load sizing jobs: {jobsRes.error.message}
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <SortableTh column="job_code" label="Job" sort={sort} dir={dir} basePath="/app/sizing" extraParams={{ tab }} className="text-left px-4 py-3" />
                  <SortableTh column="set_no" label="Set No" sort={sort} dir={dir} basePath="/app/sizing" extraParams={{ tab }} className="text-left px-4 py-3 hidden md:table-cell" />
                  <th className="text-left  px-4 py-3">Sizing Mill</th>
                  <th className="text-left  px-4 py-3 hidden md:table-cell">Yarn Supplier</th>
                  <th className="text-left  px-4 py-3 hidden lg:table-cell">Count</th>
                  <th className="text-right px-4 py-3">Beams</th>
                  <th className="text-right px-4 py-3">Yarn (sent → bal)</th>
                  <th className="text-left  px-4 py-3 hidden lg:table-cell">Recv</th>
                  <th className="text-left  px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {jobsRes.data?.length ? jobsRes.data.map((j: any) => {
                  const balance = Number(j.yarn_sent_kg) - Number(j.yarn_used_kg);
                  return (
                    <tr key={j.id} className="border-t border-line/40 hover:bg-haze/60">
                      <td className="px-4 py-3 font-mono text-xs">
                        <Link href={`/app/sizing/${j.id}`} className="font-semibold text-ink hover:text-indigo">
                          {j.job_code}
                        </Link>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell font-mono text-xs text-ink-soft">
                        {j.set_no ?? '—'}
                      </td>
                      <td className="px-4 py-3">{j.sizing_vendor?.name ?? '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-ink-soft">
                        {j.yarn_supplier?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-ink-soft">
                        {j.warp_count?.code ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right num">{j.no_of_paavu}</td>
                      <td className="px-4 py-3 text-right num text-xs">
                        {Number(j.yarn_sent_kg).toFixed(1)}
                        <span className="text-ink-mute"> → </span>
                        <span className={balance < 0 ? 'text-rose-600 font-semibold' : 'text-emerald-700 font-semibold'}>
                          {balance.toFixed(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                        {j.date_received ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`pill ${STATUS_STYLE[j.status] ?? 'bg-slate-100 text-slate-700'}`}>
                          {j.status.replace('_', ' ')}
                        </span>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-sm text-ink-soft">
                      No sizing jobs yet.{' '}
                      <Link href="/app/sizing/new" className="text-indigo font-semibold">
                        Create the first one →
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'bills' && (
        <>
          {billsRes.error && (
            <div className="card p-4 text-sm text-err mb-4">
              Could not load sizing bills: {billsRes.error.message}
            </div>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <SortableTh column="bill_no" label="Bill No" sort={sort} dir={dir} basePath="/app/sizing" extraParams={{ tab }} className="text-left px-4 py-3" />
                  <SortableTh column="bill_date" label="Bill Date" sort={sort} dir={dir} basePath="/app/sizing" extraParams={{ tab }} className="text-left px-4 py-3" />
                  <th className="text-left  px-4 py-3">Sizing Mill</th>
                  <th className="text-left  px-4 py-3 hidden md:table-cell">Job</th>
                  <th className="text-left  px-4 py-3 hidden lg:table-cell">Count</th>
                  <th className="text-right px-4 py-3">Yarn Used (kg)</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">Rate (₹/kg)</th>
                  <th className="text-right px-4 py-3">Charges (₹)</th>
                  <th className="text-right px-4 py-3 hidden md:table-cell">GST %</th>
                  <th className="text-right px-4 py-3">Total (₹)</th>
                </tr>
              </thead>
              <tbody>
                {billsRes.data?.length ? billsRes.data.map((b: any) => (
                  <tr key={b.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/app/sizing/${b.id}`} className="text-indigo hover:underline">
                        {b.bill_no}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-soft text-xs">
                      {fmtDate(b.bill_date)}
                    </td>
                    <td className="px-4 py-3">{b.sizing_vendor?.name ?? '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell font-mono text-xs">
                      <Link href={`/app/sizing/${b.id}`} className="text-indigo hover:underline">
                        {b.job_code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-ink-soft">
                      {b.warp_count?.code ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right num">{Number(b.yarn_used_kg ?? 0).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right num hidden md:table-cell">
                      ₹ {fmtMoney(b.sizing_rate_per_kg)}
                    </td>
                    <td className="px-4 py-3 text-right num">₹ {fmtMoney(b.charges_amount)}</td>
                    <td className="px-4 py-3 text-right num hidden md:table-cell">
                      {Number(b.gst_pct ?? 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right num font-semibold">
                      ₹ {fmtMoney(b.total_amount)}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-ink-soft">
                      No sizing bills yet. Bills are recorded when a job is
                      saved with an invoice number and date — <Link
                        href="/app/sizing/new"
                        className="text-indigo font-semibold"
                      >create a new job →</Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
