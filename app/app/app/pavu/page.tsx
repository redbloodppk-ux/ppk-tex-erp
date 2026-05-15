import Link from 'next/link';
import { Factory } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';

export const metadata = { title: 'Pavu Master' };

const STATUS_STYLE: Record<string, string> = {
  in_stock: 'bg-emerald-50 text-emerald-700',
  on_loom:  'bg-indigo-50 text-indigo-700',
  finished: 'bg-slate-100 text-slate-600',
  damaged:  'bg-rose-50 text-rose-700',
  scrapped: 'bg-rose-50 text-rose-700',
};

const MODE_STYLE: Record<string, string> = {
  in_house:  'bg-indigo-50 text-indigo-700',
  outsource: 'bg-amber-50 text-amber-700',
};

export default async function PavuListPage() {
  const supabase = await createClient();
  const { data: pavus, error } = await supabase
    .from('pavu')
    .select(`
      id, pavu_code, beam_no, ends, meters, status, production_mode,
      sizing_job:sizing_job_id (
        job_code, set_no,
        warp_count:warp_count_id ( code )
      ),
      outsource_vendor:outsource_vendor_id ( name )
    `)
    .order('created_at', { ascending: false })
    .limit(200);

  return (
    <div>
      <PageHeader
        title="Pavu Master"
        subtitle="Every sized warp beam in the mill — where it is, where it's going."
        actions={
          <Link href="/app/pavu/assign" className="btn-ghost">
            <Factory className="w-4 h-4" /> Loom View
          </Link>
        }
      />

      {error && (
        <div className="card p-4 text-sm text-err mb-4">
          Could not load pavu: {error.message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="text-left  px-4 py-3">Pavu Code</th>
                <th className="text-left  px-4 py-3">Beam No</th>
                <th className="text-left  px-4 py-3 hidden md:table-cell">From Job</th>
                <th className="text-left  px-4 py-3 hidden lg:table-cell">Count</th>
                <th className="text-right px-4 py-3">Ends</th>
                <th className="text-right px-4 py-3">Metres</th>
                <th className="text-left  px-4 py-3">Routing</th>
                <th className="text-left  px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {pavus?.length ? pavus.map((p: any) => (
                <tr key={p.id} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{p.pavu_code}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.beam_no}</td>
                  <td className="px-4 py-3 hidden md:table-cell font-mono text-xs text-ink-soft">
                    {p.sizing_job?.job_code ?? '—'}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-ink-soft">
                    {p.sizing_job?.warp_count?.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right num">{p.ends}</td>
                  <td className="px-4 py-3 text-right num">{Number(p.meters).toFixed(0)}</td>
                  <td className="px-4 py-3">
                    <span className={`pill ${MODE_STYLE[p.production_mode] ?? ''}`}>
                      {p.production_mode === 'outsource'
                        ? `Outsource${p.outsource_vendor?.name ? ' · ' + p.outsource_vendor.name : ''}`
                        : 'In-house'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`pill ${STATUS_STYLE[p.status] ?? 'bg-slate-100 text-slate-600'}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-soft">
                    No pavu yet. They appear automatically when you create a{' '}
                    <Link href="/app/sizing/new" className="text-indigo font-semibold">sizing job</Link>.
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
