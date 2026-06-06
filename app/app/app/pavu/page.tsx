import Link from 'next/link';
import { Factory } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { BulkRoutingForm, type BulkJobRow, type WeavingVendor } from './bulk-routing-form';

export const metadata = { title: 'Pavu Master' };
export const dynamic = 'force-dynamic';

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Outsource Weaver party type — resolved once so we can scope the
  // weaver dropdown to parties tagged as "Outsource Weaver" only.
  // The WEAVING(VENDOR) ledger list we used previously bled in
  // anyone tagged as a generic weaving vendor (e.g. Murgan Tex)
  // even when they weren't on the outsource weaver master.
  const { data: ptRow } = await sb
    .from('party_type_master')
    .select('id')
    .eq('name', 'Outsource Weaver')
    .maybeSingle();
  const outsourceTypeId: number | null = ptRow?.id ?? null;

  // Load everything we need in parallel:
  // - pavu rows for the master list (existing behaviour, unchanged)
  // - sizing jobs + their pavu rows for the bulk routing form
  // - Outsource Weaver parties for the routing dropdown
  const [pavusRes, jobsRes, partiesRes] = await Promise.all([
    sb.from('pavu').select(`
      id, pavu_code, beam_no, ends, meters, status, production_mode,
      sizing_job:sizing_job_id (
        job_code, set_no,
        warp_count:warp_count_id ( code )
      ),
      outsource_vendor:outsource_ledger_id ( name )
    `).order('created_at', { ascending: false }).limit(200),
    sb.from('sizing_job').select(`
      id, job_code, set_no,
      pavu_rows:pavu (
        id, beam_no, ends, meters,
        production_mode, outsource_ledger_id,
        outsource_vendor:outsource_ledger_id ( name )
      )
    `).order('created_at', { ascending: false }).limit(100),
    outsourceTypeId == null
      ? Promise.resolve({ data: [] })
      : sb.from('party')
          .select('id, name, ledger_id, party_type_ids')
          .eq('status', 'active')
          .contains('party_type_ids', [outsourceTypeId])
          .order('name'),
  ]);

  const pavus    = (pavusRes.data    ?? []) as Array<Record<string, unknown>>;
  const rawJobs  = (jobsRes.data     ?? []) as Array<{
    id: number; job_code: string; set_no: string | null;
    pavu_rows: Array<{
      id: number;
      beam_no: string;
      ends: number;
      meters: number | string | null;
      production_mode: 'in_house' | 'outsource' | null;
      outsource_ledger_id: number | null;
      outsource_vendor: { name: string } | null;
    }>;
  }>;
  // The party row carries the operator-friendly name; the linked
  // ledger_id is what pavu.outsource_ledger_id actually stores. We
  // drop parties without a linked ledger because the foreign key
  // would reject those on save.
  const vendors = ((partiesRes.data ?? []) as Array<{ id: number; name: string; ledger_id: number | null }>)
    .filter((p) => p.ledger_id != null)
    .map<WeavingVendor>((p) => ({ id: p.ledger_id as number, name: p.name }));

  // Build the BulkJobRow list — collapses each job's pavu rows into a
  // unanimous mode + vendor where the rows agree, otherwise flags as
  // mixed. We skip jobs with zero beams (nothing to route).
  const bulkJobs: BulkJobRow[] = rawJobs
    .filter((j) => j.pavu_rows.length > 0)
    .map((j) => {
      const totalMetres = j.pavu_rows.reduce((s, r) => s + Number(r.meters ?? 0), 0);
      const beamCount   = j.pavu_rows.length;
      const modesSet    = new Set(j.pavu_rows.map((r) => r.production_mode ?? 'in_house'));
      const vendorsSet  = new Set(j.pavu_rows.map((r) => r.outsource_ledger_id ?? null));
      let current_mode: BulkJobRow['current_mode'] = null;
      let current_vendor_id:   number | null = null;
      let current_vendor_name: string | null = null;
      if (modesSet.size > 1) {
        current_mode = 'mixed';
      } else {
        const onlyMode = modesSet.values().next().value as 'in_house' | 'outsource';
        if (onlyMode === 'in_house') {
          current_mode = 'in_house';
        } else if (vendorsSet.size === 1) {
          current_mode = 'outsource';
          current_vendor_id = j.pavu_rows[0]!.outsource_ledger_id;
          current_vendor_name = j.pavu_rows[0]!.outsource_vendor?.name ?? null;
        } else {
          // Outsource across multiple vendors → still mixed for routing.
          current_mode = 'mixed';
        }
      }
      return {
        id: j.id,
        job_code: j.job_code,
        set_no: j.set_no,
        beam_count: beamCount,
        total_warp_metres: totalMetres,
        current_mode,
        current_vendor_id,
        current_vendor_name,
        // Beam-level data so the form can switch into beam-wise mode
        // (one vendor per beam) when the operator wants to split a
        // job across multiple outsource weavers.
        beams: j.pavu_rows.map((r) => ({
          id: r.id,
          beam_no: r.beam_no,
          ends: Number(r.ends ?? 0),
          meters: Number(r.meters ?? 0),
          production_mode: r.production_mode,
          outsource_ledger_id: r.outsource_ledger_id,
          outsource_vendor_name: r.outsource_vendor?.name ?? null,
        })),
      };
    });

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

      {/* Bulk routing form — one row per sizing job. Lets the operator
          pick in-house / outsource for every beam of a job in one go,
          with an outsource weaver picker that surfaces only when the
          routing is set to outsource. */}
      <section className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display font-bold text-sm">
            Bulk routing <span className="text-ink-mute">· by sizing job</span>
          </h2>
          <span className="text-xs text-ink-mute">
            {bulkJobs.length} job{bulkJobs.length === 1 ? '' : 's'} with sized beams
          </span>
        </div>

        {jobsRes.error && (
          <div className="card p-3 mb-3 text-err text-xs">
            Could not load sizing jobs: {jobsRes.error.message}
          </div>
        )}

        <BulkRoutingForm jobs={bulkJobs} vendors={vendors} />
      </section>

      {/* Pavu list (existing) */}
      <section>
        <h2 className="font-display font-bold text-sm mb-2">
          Pavu list <span className="text-ink-mute">· every sized beam</span>
        </h2>

        {pavusRes.error && (
          <div className="card p-4 text-sm text-err mb-4">
            Could not load pavu: {pavusRes.error.message}
          </div>
        )}

        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
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
              {pavus.length ? pavus.map((p: any) => (
                <tr key={p.id as number} className="border-t border-line/40 hover:bg-haze/60">
                  <td className="px-4 py-3 font-mono text-xs font-semibold text-ink">{p.pavu_code as string}</td>
                  <td className="px-4 py-3 font-mono text-xs">{p.beam_no as string}</td>
                  <td className="px-4 py-3 hidden md:table-cell font-mono text-xs text-ink-soft">
                    {p.sizing_job?.job_code ?? '—'}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-ink-soft">
                    {p.sizing_job?.warp_count?.code ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right num">{p.ends as number}</td>
                  <td className="px-4 py-3 text-right num">{Number(p.meters).toFixed(0)}</td>
                  <td className="px-4 py-3">
                    <span className={`pill ${MODE_STYLE[p.production_mode as string] ?? ''}`}>
                      {p.production_mode === 'outsource'
                        ? `Outsource${p.outsource_vendor?.name ? ' · ' + p.outsource_vendor.name : ''}`
                        : 'In-house'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`pill ${STATUS_STYLE[p.status as string] ?? 'bg-slate-100 text-slate-600'}`}>
                      {(p.status as string).replace('_', ' ')}
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
      </section>
    </div>
  );
}
