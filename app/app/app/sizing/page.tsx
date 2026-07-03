import Link from 'next/link';
import { Plus, Pencil } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { SortableTh, type SortDir } from '@/app/components/sortable-th';
import { SizingJobDeleteButton } from './sizing-job-delete-button';
import { SizingPaymentTab } from './sizing-payment-tab';
import { CardFilter } from '@/app/components/card-filter';

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

type Tab = 'jobs' | 'bills' | 'payment';

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

// Bills are displayed in whole rupees — sizing-mill invoices come in
// whole-rupee figures and the prior 2-decimal display was creating
// spurious mismatches against the paper bill.
function fmtMoney(v: unknown): string {
  return Math.round(Number(v ?? 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default async function SizingListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'bills'   ? 'bills'
                  : sp.tab === 'payment' ? 'payment'
                  : 'jobs';

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
          yarn_sent_kg, yarn_used_kg, no_of_paavu, yarn_lot_id,
          sizing_vendor:sizing_ledger_id ( name ),
          yarn_supplier:yarn_supplier_party_id ( name ),
          warp_count:warp_count_id        ( code )
        `)
        .order(sort, { ascending: dir === 'asc' })
        .order('created_at', { ascending: false })
        .limit(100)
    : { data: [], error: null };

  // Per-job total warp metres = sum of pavu.meters across every beam
  // on the job. We pull the pavu rows once and aggregate in JS — the
  // mill rarely has more than a few hundred jobs in the visible page,
  // and Postgres has no straight aggregation view for this yet.
  const warpMetresByJob = new Map<number, number>();
  if (tab === 'jobs' && (jobsRes.data?.length ?? 0) > 0) {
    const jobIds = (jobsRes.data as Array<{ id: number }>).map((j) => j.id);
    const { data: pavuRows } = await sb
      .from('pavu')
      .select('sizing_job_id, meters')
      .in('sizing_job_id', jobIds);
    for (const p of (pavuRows ?? []) as Array<{ sizing_job_id: number; meters: number | string | null }>) {
      const id = p.sizing_job_id;
      const m  = Number(p.meters ?? 0);
      warpMetresByJob.set(id, (warpMetresByJob.get(id) ?? 0) + m);
    }
  }

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
        <Link
          href="/app/sizing?tab=payment"
          className={
            'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
            (tab === 'payment'
              ? 'border-indigo text-indigo bg-indigo-50/60'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
          }
        >
          Payment
        </Link>
      </div>

      {tab === 'payment' && <SizingPaymentTab />}

      {tab === 'jobs' && (
        <>
          {jobsRes.error && (
            <div className="card p-4 text-sm text-err mb-4">
              Could not load sizing jobs: {jobsRes.error.message}
            </div>
          )}

          {/* Mobile / PWA: card view. The wide jobs table forces
              horizontal scrolling on a phone, so below md we render each
              job as a tap-friendly card. The table below is hidden on mobile. */}
          <CardFilter placeholder="Search sizing jobs…">
            {jobsRes.data?.length ? jobsRes.data.map((j: any) => {
              return (
                <div key={j.id} className="card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/app/sizing/${j.id}`} className="font-mono text-xs font-semibold text-ink hover:text-indigo break-words">
                        {j.job_code}
                      </Link>
                      <div className="text-sm font-medium mt-0.5 break-words">{j.sizing_vendor?.name ?? '—'}</div>
                    </div>
                    <span className={`pill ${STATUS_STYLE[j.status] ?? 'bg-slate-100 text-slate-700'} shrink-0`}>
                      {j.status.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="text-xs text-ink-soft mt-1">
                    <span className="text-ink-mute">Set No: </span><span className="font-mono">{j.set_no ?? '—'}</span>
                    <span className="text-ink-mute"> · Count: </span><span className="font-mono">{j.warp_count?.code ?? '—'}</span>
                  </div>
                  <div className="text-xs text-ink-soft mt-1">
                    <span className="text-ink-mute">Yarn Supplier: </span>{j.yarn_supplier?.name ?? '—'}
                  </div>
                  <div className="text-xs text-ink-soft mt-1">
                    <span className="text-ink-mute">Beams: </span><span className="num">{j.no_of_paavu}</span>
                    <span className="text-ink-mute"> · Total Warp (m): </span>
                    <span className="num">{(warpMetresByJob.get(j.id) ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                  </div>
                  {j.date_received && (
                    <div className="text-xs text-ink-soft mt-1">
                      <span className="text-ink-mute">Recv: </span>{j.date_received}
                    </div>
                  )}

                  <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                    <Link
                      href={`/app/sizing/${j.id}`}
                      className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
                      title={`Edit ${j.job_code}`}
                      aria-label={`Edit ${j.job_code}`}
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </Link>
                    <SizingJobDeleteButton
                      jobId={j.id}
                      jobCode={j.job_code}
                      yarnSentKg={Number(j.yarn_sent_kg ?? 0)}
                      yarnLotId={j.yarn_lot_id ?? null}
                    />
                  </div>
                </div>
              );
            }) : (
              <div className="card p-6 text-center text-sm text-ink-soft">
                No sizing jobs yet.{' '}
                <Link href="/app/sizing/new" className="text-indigo font-semibold">
                  Create the first one →
                </Link>
              </div>
            )}
          </CardFilter>

          <div className="card overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <SortableTh column="job_code" label="Job" sort={sort} dir={dir} basePath="/app/sizing" extraParams={{ tab }} className="text-left px-4 py-3" />
                  <SortableTh column="set_no" label="Set No" sort={sort} dir={dir} basePath="/app/sizing" extraParams={{ tab }} className="text-left px-4 py-3 hidden md:table-cell" />
                  <th className="text-left  px-4 py-3">Sizing Mill</th>
                  <th className="text-left  px-4 py-3 hidden md:table-cell">Yarn Supplier</th>
                  <th className="text-left  px-4 py-3 hidden lg:table-cell">Count</th>
                  <th className="text-right px-4 py-3">Beams</th>
                  <th className="text-right px-4 py-3">Total Warp (m)</th>
                  <th className="text-left  px-4 py-3 hidden lg:table-cell">Recv</th>
                  <th className="text-left  px-4 py-3">Status</th>
                  <th className="text-right px-4 py-3 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobsRes.data?.length ? jobsRes.data.map((j: any) => {
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
                      <td className="px-4 py-3 text-right num">
                        {(warpMetresByJob.get(j.id) ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell text-xs text-ink-soft">
                        {j.date_received ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`pill ${STATUS_STYLE[j.status] ?? 'bg-slate-100 text-slate-700'}`}>
                          {j.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <Link
                          href={`/app/sizing/${j.id}`}
                          className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex mr-1"
                          title={`Edit ${j.job_code}`}
                          aria-label={`Edit ${j.job_code}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Link>
                        <SizingJobDeleteButton
                          jobId={j.id}
                          jobCode={j.job_code}
                          yarnSentKg={Number(j.yarn_sent_kg ?? 0)}
                          yarnLotId={j.yarn_lot_id ?? null}
                        />
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-sm text-ink-soft">
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

          {/* Mobile / PWA: card view. The wide bills table forces
              horizontal scrolling on a phone, so below md we render each
              bill as a tap-friendly card. The table below is hidden on mobile. */}
          <CardFilter placeholder="Search sizing bills…">
            {billsRes.data?.length ? billsRes.data.map((b: any) => (
              <div key={b.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/app/sizing/${b.id}/bill`} className="font-mono text-xs font-semibold text-ink hover:text-indigo break-words">
                      {b.bill_no}
                    </Link>
                    <div className="text-sm font-medium mt-0.5 break-words">{b.sizing_vendor?.name ?? '—'}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] uppercase tracking-wide text-ink-mute">Total</div>
                    <div className="num font-semibold text-base">₹ {fmtMoney(b.total_amount)}</div>
                  </div>
                </div>

                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Bill Date: </span>{fmtDate(b.bill_date)}
                  <span className="text-ink-mute"> · Job: </span>
                  <Link href={`/app/sizing/${b.id}`} className="font-mono text-indigo hover:underline">{b.job_code}</Link>
                </div>
                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Count: </span><span className="font-mono">{b.warp_count?.code ?? '—'}</span>
                  <span className="text-ink-mute"> · Yarn Used (kg): </span><span className="num">{Number(b.yarn_used_kg ?? 0).toFixed(2)}</span>
                </div>
                <div className="text-xs text-ink-soft mt-1">
                  <span className="text-ink-mute">Rate (₹/kg): </span><span className="num">₹ {fmtMoney(b.sizing_rate_per_kg)}</span>
                  <span className="text-ink-mute"> · Charges: </span><span className="num">₹ {fmtMoney(b.charges_amount)}</span>
                  <span className="text-ink-mute"> · GST %: </span><span className="num">{Number(b.gst_pct ?? 0).toFixed(2)}</span>
                </div>

                <div className="flex items-center gap-4 mt-3 pt-2 border-t border-line/40">
                  <Link
                    href={`/app/sizing/${b.id}/bill`}
                    className="inline-flex items-center gap-1 text-xs text-indigo-700 font-semibold"
                    title={`Edit bill ${b.bill_no}`}
                    aria-label={`Edit bill ${b.bill_no}`}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </Link>
                </div>
              </div>
            )) : (
              <div className="card p-6 text-center text-sm text-ink-soft">
                No sizing bills yet. Bills are recorded when a job is
                saved with an invoice number and date — <Link
                  href="/app/sizing/new"
                  className="text-indigo font-semibold"
                >create a new job →</Link>
              </div>
            )}
          </CardFilter>

          <div className="card overflow-x-auto hidden md:block">
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
                  <th className="text-right px-4 py-3 w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {billsRes.data?.length ? billsRes.data.map((b: any) => (
                  <tr key={b.id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-4 py-3 font-mono text-xs">
                      <Link href={`/app/sizing/${b.id}/bill`} className="text-indigo hover:underline">
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
                    {/* Edit only — bills can't be deleted standalone.
                        Removing a bill is done by deleting the parent
                        job from the Jobs tab, which drops the whole
                        row this bill lives on. */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Link
                        href={`/app/sizing/${b.id}/bill`}
                        className="p-1 rounded hover:bg-indigo-50 text-indigo-700 inline-flex"
                        title={`Edit bill ${b.bill_no}`}
                        aria-label={`Edit bill ${b.bill_no}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={11} className="px-4 py-10 text-center text-sm text-ink-soft">
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
