import Link from 'next/link';
import { Factory } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { BulkRoutingForm, type BulkJobRow, type WeavingVendor } from './bulk-routing-form';
import { PavuListEditor, type PavuRow } from './pavu-list-editor';

export const metadata = { title: 'Pavu Master' };
export const dynamic = 'force-dynamic';

type Tab = 'inhouse' | 'outsource';

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function PavuListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'outsource' ? 'outsource' : 'inhouse';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Outsource Weaver party type — used as the source of the weaver
  // dropdown in both the bulk routing form and the per-row editor.
  const { data: ptRow } = await sb
    .from('party_type_master')
    .select('id')
    .eq('name', 'Outsource Weaver')
    .maybeSingle();
  const outsourceTypeId: number | null = ptRow?.id ?? null;

  const [pavusRes, jobsRes, partiesRes] = await Promise.all([
    sb.from('pavu').select(`
      id, pavu_code, beam_no, ends, meters, status, production_mode,
      outsource_ledger_id,
      sizing_job:sizing_job_id (
        job_code, set_no,
        warp_count:warp_count_id ( code )
      ),
      outsource_vendor:outsource_ledger_id ( name )
    `).order('created_at', { ascending: false }).limit(300),
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

  // ── Vendor list (party-backed, value = party.ledger_id) ──
  const vendors = ((partiesRes.data ?? []) as Array<{ id: number; name: string; ledger_id: number | null }>)
    .filter((p) => p.ledger_id != null)
    .map<WeavingVendor>((p) => ({ id: p.ledger_id as number, name: p.name }));

  // ── Pavu rows for the active tab ──
  const allPavus = ((pavusRes.data ?? []) as Array<{
    id: number; pavu_code: string; beam_no: string;
    ends: number; meters: number | string;
    status: string;
    production_mode: 'in_house' | 'outsource';
    outsource_ledger_id: number | null;
    sizing_job: { job_code: string | null; warp_count: { code: string | null } | null } | null;
    outsource_vendor: { name: string } | null;
  }>);
  const pavus: PavuRow[] = allPavus.map((p) => ({
    id: p.id,
    pavu_code: p.pavu_code,
    beam_no: p.beam_no,
    ends: Number(p.ends ?? 0),
    meters: Number(p.meters ?? 0),
    status: p.status,
    production_mode: p.production_mode,
    outsource_ledger_id: p.outsource_ledger_id,
    sizing_job_code: p.sizing_job?.job_code ?? null,
    warp_count_code: p.sizing_job?.warp_count?.code ?? null,
    outsource_vendor_name: p.outsource_vendor?.name ?? null,
  }));
  const tabPavus = pavus.filter((p) =>
    tab === 'inhouse' ? p.production_mode === 'in_house' : p.production_mode === 'outsource',
  );

  // ── Bulk routing rows (Outsource tab only) ──
  const rawJobs = (jobsRes.data ?? []) as Array<{
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
  const bulkJobs: BulkJobRow[] = rawJobs
    .filter((j) => Array.isArray(j.pavu_rows) && j.pavu_rows.length > 0)
    .map((j) => {
      const rows        = Array.isArray(j.pavu_rows) ? j.pavu_rows : [];
      const totalMetres = rows.reduce((s, r) => s + Number(r.meters ?? 0), 0);
      const beamCount   = rows.length;
      const modesSet    = new Set(rows.map((r) => r.production_mode ?? 'in_house'));
      const vendorsSet  = new Set(rows.map((r) => r.outsource_ledger_id ?? null));
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
          current_vendor_id = rows[0]?.outsource_ledger_id ?? null;
          current_vendor_name = rows[0]?.outsource_vendor?.name ?? null;
        } else {
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
        beams: rows.map((r) => ({
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

  const tabLink = (next: Tab): string => `/app/pavu?tab=${next}`;

  return (
    <div>
      <PageHeader
        title="Pavu Master"
        subtitle="Every sized warp beam in the mill. Switch tabs to see in-house vs outsource routing; the table itself is editable."
        actions={
          <Link href="/app/pavu/assign" className="btn-ghost">
            <Factory className="w-4 h-4" /> Loom View
          </Link>
        }
      />

      {/* Tab strip */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-line/60">
        <Link
          href={tabLink('inhouse')}
          className={
            'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
            (tab === 'inhouse'
              ? 'border-indigo text-indigo bg-indigo-50/60'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
          }
        >
          In-house ({pavus.filter((p) => p.production_mode === 'in_house').length})
        </Link>
        <Link
          href={tabLink('outsource')}
          className={
            'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
            (tab === 'outsource'
              ? 'border-indigo text-indigo bg-indigo-50/60'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
          }
        >
          Outsource ({pavus.filter((p) => p.production_mode === 'outsource').length})
        </Link>
      </div>

      {/* Bulk routing form — only useful on the Outsource tab */}
      {tab === 'outsource' && (
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
      )}

      {/* Pavu list — editable per row, scoped to the active tab */}
      <section>
        <h2 className="font-display font-bold text-sm mb-2">
          {tab === 'inhouse' ? 'In-house pavu' : 'Outsource pavu'}{' '}
          <span className="text-ink-mute">· edit Mode &amp; Weaver per row</span>
        </h2>

        {pavusRes.error && (
          <div className="card p-4 text-sm text-err mb-4">
            Could not load pavu: {pavusRes.error.message}
          </div>
        )}

        <PavuListEditor rows={tabPavus} vendors={vendors} scope={tab} />
      </section>
    </div>
  );
}
