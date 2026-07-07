import Link from 'next/link';
import { Factory, Shuffle, X, ClipboardList } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { BulkRoutingForm, type BulkJobRow, type WeavingVendor } from './bulk-routing-form';
import { PavuListEditor, type PavuRow } from './pavu-list-editor';
import { JobworkBeamsTable, type JobworkBeamRow } from './jobwork-beams-table';

export const metadata = { title: 'Pavu Master' };
export const dynamic = 'force-dynamic';

type Tab = 'inhouse' | 'outsource' | 'jobwork';

interface PageProps {
  searchParams: Promise<{ tab?: string; bulk?: string }>;
}

export default async function PavuListPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === 'outsource' ? 'outsource' : sp.tab === 'jobwork' ? 'jobwork' : 'inhouse';
  // The bulk-routing form is hidden by default and toggled via a
  // header button. We use a URL search param so the toggle survives
  // page refreshes and back/forward navigation.
  const bulkOpen = sp.bulk === 'open';

  const supabase = await createClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;

  // Source the outsource-weaver dropdown from `jobwork_party`
  // (kind='outsource'). After migration 121, every jobwork_party row
  // has its own auto-linked WEAVING(VENDOR) ledger via
  // jobwork_party.ledger_id. Using the same source as
  // /app/outsource → Warp Beam Given guarantees the warp-given form's
  // cascade (sizing party / sizing job by outsource party) can find
  // matches — pavu.outsource_ledger_id stored on assignment is the
  // SAME ledger id the warp-given form's outsourcePartyLedger map
  // reads. The legacy party-master route (Outsource Weaver type)
  // used a different ledger and broke the cascade.

  const [pavusRes, jobsRes, partiesRes, jobworkPartiesRes, jobworkBeamsRes, fabricQualityRes, yarnCountRes] = await Promise.all([
    sb.from('pavu').select(`
      id, pavu_code, beam_no, ends, meters, status, production_mode,
      outsource_ledger_id, jobwork_ledger_id, created_at,
      sizing_job:sizing_job_id (
        job_code, set_no, date_sent,
        warp_count:warp_count_id ( code )
      ),
      outsource_vendor:outsource_ledger_id ( name ),
      jobwork_vendor:jobwork_ledger_id ( name )
    `).order('created_at', { ascending: false }).limit(300),
    sb.from('sizing_job').select(`
      id, job_code, set_no,
      pavu_rows:pavu (
        id, beam_no, ends, meters,
        production_mode, outsource_ledger_id,
        outsource_vendor:outsource_ledger_id ( name )
      )
    `).order('created_at', { ascending: false }).limit(100),
    sb.from('jobwork_party')
      .select('id, name, ledger_id')
      .eq('kind', 'outsource')
      .eq('status', 'active')
      .order('name'),
    sb.from('jobwork_party')
      .select('id, name, ledger_id')
      .eq('kind', 'jobwork')
      .eq('status', 'active')
      .order('name'),
    // All beams given to jobwork parties (see /app/jobwork → Warp beam
    // given) — both manual entries and any pavu-routed mirror rows.
    // Filtered to jobwork-kind parties below in JS, the same way
    // jobwork/page.tsx does it (partyById.has(...)), so we don't need
    // the FK-relationship name for an embedded-resource filter here.
    sb.from('jobwork_warp_beam')
      .select('id, jobwork_party_id, fabric_quality_id, warp_count_id, given_date, total_ends, beam_count, total_metres, original_metres, pavu_id, pavu_ids, sizing_set_no')
      .eq('status', 'active')
      .order('given_date', { ascending: false }),
    sb.from('fabric_quality').select('id, name'),
    sb.from('yarn_count').select('id, display_name'),
  ]);

  // ── Vendor / Jobwork party lists ──
  // Value = jobwork_party.ledger_id (created/linked by migration
  // 121's trigger). Parties without a linked ledger are dropped
  // because the FK on pavu.outsource_ledger_id / jobwork_ledger_id
  // would reject them.
  const vendors = ((partiesRes.data ?? []) as Array<{ id: number; name: string; ledger_id: number | null }>)
    .filter((p) => p.ledger_id != null)
    .map<WeavingVendor>((p) => ({ id: p.ledger_id as number, name: p.name }));

  // ── Jobwork beams (Jobwork tab) ──
  // jobwork_warp_beam.jobwork_party_id is a FK to jobwork_party.id
  // directly (not ledger_id) — mirrors the filter used in
  // /app/jobwork's WarpBeamTab (partyById.has(w.jobwork_party_id)).
  const jobworkPartyRows = (jobworkPartiesRes.data ?? []) as Array<{ id: number; name: string }>;
  const jobworkPartyNameById = new Map(jobworkPartyRows.map((p) => [p.id, p.name]));
  const fabricQualityNameById = new Map(
    ((fabricQualityRes.data ?? []) as Array<{ id: number; name: string }>).map((q) => [q.id, q.name])
  );
  const warpCountDisplayById = new Map(
    ((yarnCountRes.data ?? []) as Array<{ id: number; display_name: string }>).map((c) => [c.id, c.display_name])
  );
  const rawJobworkBeams = ((jobworkBeamsRes.data ?? []) as Array<{
    id: number; jobwork_party_id: number;
    fabric_quality_id: number | null; warp_count_id: number | null;
    given_date: string; total_ends: number | null; beam_count: number;
    total_metres: number | null; original_metres: number | null;
    pavu_id: number | null; pavu_ids: number[] | null;
    sizing_set_no: string | null;
  }>).filter((w) => jobworkPartyNameById.has(w.jobwork_party_id));

  // Resolve Pavu codes for any linked rows (pavu_id / pavu_ids) —
  // manual entries from the Add form have neither and show "—".
  const linkedPavuIds = Array.from(new Set(
    rawJobworkBeams.flatMap((w) => [w.pavu_id, ...(w.pavu_ids ?? [])]).filter((id): id is number => id != null)
  ));
  const pavuCodeById = new Map<number, string>();
  const pavuStatusById = new Map<number, string>();
  const pavuBeamNoById = new Map<number, string>();
  if (linkedPavuIds.length > 0) {
    const { data: linkedPavus } = await sb.from('pavu').select('id, pavu_code, beam_no, status').in('id', linkedPavuIds);
    for (const row of (linkedPavus ?? []) as Array<{ id: number; pavu_code: string; beam_no: string | null; status: string }>) {
      pavuCodeById.set(row.id, row.pavu_code);
      pavuStatusById.set(row.id, row.status);
      if (row.beam_no != null && row.beam_no !== '') pavuBeamNoById.set(row.id, row.beam_no);
    }
  }
  const jobworkBeams: JobworkBeamRow[] = rawJobworkBeams.map((w) => {
    const ids = [w.pavu_id, ...(w.pavu_ids ?? [])].filter((id): id is number => id != null);
    const codes = ids.map((id) => pavuCodeById.get(id)).filter((c): c is string => c != null);
    const beamNos = ids.map((id) => pavuBeamNoById.get(id)).filter((b): b is string => b != null);
    const firstId = ids.length > 0 ? ids[0] : undefined;
    return {
      id: w.id,
      given_date: w.given_date,
      party_name: jobworkPartyNameById.get(w.jobwork_party_id) ?? '-',
      quality_name: w.fabric_quality_id != null ? fabricQualityNameById.get(w.fabric_quality_id) ?? null : null,
      warp_count_display: w.warp_count_id != null ? warpCountDisplayById.get(w.warp_count_id) ?? null : null,
      total_ends: w.total_ends,
      beam_count: w.beam_count,
      beam_nos: beamNos,
      metres: Number((w.original_metres ?? w.total_metres) ?? 0),
      pavu_codes: codes,
      pavu_ids: ids,
      pavu_status: firstId != null ? (pavuStatusById.get(firstId) ?? null) : null,
      sizing_set_no: w.sizing_set_no,
    };
  });

  // ── Pavu rows for the active tab ──
  const allPavus = ((pavusRes.data ?? []) as Array<{
    id: number; pavu_code: string; beam_no: string;
    ends: number; meters: number | string;
    status: string;
    production_mode: 'in_house' | 'outsource' | 'jobwork';
    outsource_ledger_id: number | null;
    jobwork_ledger_id: number | null;
    created_at: string | null;
    sizing_job: { job_code: string | null; set_no: string | null; date_sent: string | null; warp_count: { code: string | null } | null } | null;
    outsource_vendor: { name: string } | null;
    jobwork_vendor: { name: string } | null;
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
    jobwork_ledger_id: p.jobwork_ledger_id,
    sizing_job_code: p.sizing_job?.job_code ?? null,
    sizing_set_no: p.sizing_job?.set_no ?? null,
    // Group date: the sizing job's sent date when known, else the day
    // the pavu row itself was created — used only for the group
    // headers on the Pavu Master table.
    group_date: p.sizing_job?.date_sent ?? (p.created_at ? String(p.created_at).slice(0, 10) : null),
    warp_count_code: p.sizing_job?.warp_count?.code ?? null,
    outsource_vendor_name: p.outsource_vendor?.name ?? null,
    jobwork_vendor_name: p.jobwork_vendor?.name ?? null,
  }));
  const tabPavus = pavus.filter((p) => {
    if (tab === 'inhouse') return p.production_mode === 'in_house';
    if (tab === 'outsource') return p.production_mode === 'outsource';
    return p.production_mode === 'jobwork';
  });

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
  // Bulk-routing toggle preserves the active tab so flipping the
  // form open / closed doesn't bounce the operator back to In-house.
  const bulkToggleHref = bulkOpen
    ? `/app/pavu?tab=${tab}`
    : `/app/pavu?tab=${tab}&bulk=open`;

  return (
    <div>
      <PageHeader
        title="Pavu Master"
        subtitle="Every sized warp beam in the mill. Switch tabs to see in-house vs outsource routing; the table itself is editable."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Bulk-routing toggle — available on both tabs because
                the operator may want to route in-house beams out, or
                rearrange outsource assignments, from either side. */}
            <Link
              href={bulkToggleHref}
              className={bulkOpen ? 'btn-ghost' : 'btn-secondary'}
              scroll={false}
            >
              {bulkOpen
                ? <><X className="w-4 h-4" /> Hide bulk routing</>
                : <><Shuffle className="w-4 h-4" /> Bulk routing</>}
            </Link>
            <Link href="/app/pavu/assign" className="btn-ghost">
              <Factory className="w-4 h-4" /> Loom View
            </Link>
            <Link href="/app/pavu/report" className="btn-ghost">
              <ClipboardList className="w-4 h-4" /> Stock Report
            </Link>
          </div>
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
        <Link
          href={tabLink('jobwork')}
          className={
            'px-4 py-2 text-sm font-medium rounded-t -mb-px border-b-2 transition ' +
            (tab === 'jobwork'
              ? 'border-indigo text-indigo bg-indigo-50/60'
              : 'border-transparent text-ink-soft hover:text-ink hover:bg-haze/60')
          }
        >
          Jobwork ({jobworkBeams.length})
        </Link>
      </div>

      {/* Bulk routing form — visible on either tab whenever the
          header toggle is on (?bulk=open). The form itself handles
          both in-house and outsource routing per job. */}
      {bulkOpen && (
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
        {tab === 'jobwork' ? (
          <>
            <h2 className="font-display font-bold text-sm mb-2">
              Jobwork beams <span className="text-ink-mute">· all beams given to jobwork parties, with Pavu code where linked</span>
            </h2>
            {jobworkBeamsRes.error && (
              <div className="card p-4 text-sm text-err mb-4">
                Could not load jobwork beams: {jobworkBeamsRes.error.message}
              </div>
            )}
            <JobworkBeamsTable rows={jobworkBeams} />
          </>
        ) : (
          <>
            <h2 className="font-display font-bold text-sm mb-2">
              {tab === 'inhouse' ? 'In-house pavu' : 'Outsource pavu'}{' '}
              <span className="text-ink-mute">· edit Mode &amp; Party per row</span>
            </h2>

            {pavusRes.error && (
              <div className="card p-4 text-sm text-err mb-4">
                Could not load pavu: {pavusRes.error.message}
              </div>
            )}

            <PavuListEditor rows={tabPavus} vendors={vendors} scope={tab} />
          </>
        )}
      </section>
    </div>
  );
}
