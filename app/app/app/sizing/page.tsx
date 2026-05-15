import Link from 'next/link';
import { Plus } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';

export const metadata = { title: 'Sizing Jobs' };

const STATUS_STYLE: Record<string, string> = {
  draft:      'bg-slate-100 text-slate-700',
  sent:       'bg-amber-50 text-amber-700',
  in_process: 'bg-indigo-50 text-indigo-700',
  received:   'bg-emerald-50 text-emerald-700',
  assigned:   'bg-violet-50 text-violet-700',
  done:       'bg-slate-100 text-slate-600',
  cancelled:  'bg-rose-50 text-rose-700',
};

export default async function SizingListPage() {
  const supabase = await createClient();

  // Pull each job plus the foreign-key labels we want to show. PostgREST
  // resolves the joins for us. We also pull the pavu count so the user can
  // see how many beams came back per job.
  const { data: jobs, error } = await supabase
    .from('sizing_job')
    .select(`
      id, job_code, set_no, status, date_sent, date_received,
      yarn_sent_kg, yarn_used_kg, no_of_paavu,
      sizing_vendor:sizing_vendor_id ( name ),
      yarn_mill:yarn_mill_id          ( name ),
      warp_count:warp_count_id        ( code )
    `)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <div>
      <PageHeader
        title="Sizing Jobs"
        subtitle="One job per vendor SET NO. Tap a row to see its beams and yarn balance."
        actions={
          <Link href="/app/sizing/new" className="btn-primary">
            <Plus className="w-4 h-4" /> New Sizing Job
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load sizing jobs: {error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-4 py-3">Job</th>
                <th className="text-left  px-4 py-3 hidden md:table-cell">Set No</th>
                <th className="text-left  px-4 py-3">Sizing Mill</th>
                <th className="text-left  px-4 py-3 hidden md:table-cell">Yarn Mill</th>
                <th className="text-left  px-4 py-3 hidden lg:table-cell">Count</th>
                <th className="text-right px-4 py-3">Beams</th>
                <th className="text-right px-4 py-3">Yarn (sent → bal)</th>
                <th className="text-left  px-4 py-3 hidden lg:table-cell">Recv</th>
                <th className="text-left  px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs?.length ? jobs.map((j: any) => {
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
                      {j.yarn_mill?.name ?? '—'}
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
      </div>
    </div>
  );
}
