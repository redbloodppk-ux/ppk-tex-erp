/**
 * Pavu Mount History report
 *
 * Every mount event recorded in pavu_assign, filtered to a chosen date
 * range on the MOUNT date (start_date). Complements the Beam Stock Report
 * (fn_pavu_stock_report), which only shows the CURRENT status of each
 * beam — this report is the permanent history of which beam went on
 * which loom, when it came off, and how many metres it produced.
 *
 * URL params:
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD   (defaults: 1st of this month → today)
 *   ?loom_id=<id>
 *   ?shed=<shed_no>
 *   ?mode=in_house|jobwork|outsource
 *   ?quality_code=<text>
 *   ?ends=<number>
 */
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/app/components/page-header';
import { CardFilter } from '@/app/components/card-filter';
import { ExcelExportButton } from '@/app/components/excel-export-button';
import { formatMetres } from '@/lib/utils';
import type { ExcelColumn } from '@/lib/xlsx';
import { History, Layers, Gauge } from 'lucide-react';

export const metadata = { title: 'Pavu Mount History' };
export const dynamic = 'force-dynamic';

/* ─────────────── types ─────────────── */

interface MountHistoryRow {
  assign_id: number;
  pavu_id: number;
  pavu_code: string;
  beam_no: string;
  ends: number;
  yarn_count: string | null;
  quality_code: string | null;
  quality_name: string | null;
  production_mode: string | null;
  loom_id: number | null;
  loom_code: string | null;
  shed_no: number | null;
  mount_date: string | null;
  unmount_date: string | null;
  days_mounted: number | null;
  metres_produced: number;
  actual_metres: number;
  status: string;
  notes: string | null;
}

interface RawAssignRow {
  id: number;
  pavu_id: number;
  loom_id: number | null;
  costing_id: number | null;
  start_date: string | null;
  end_date: string | null;
  metres_produced: number | string | null;
  actual_metres: number | string | null;
  status: string;
  notes: string | null;
  pavu: {
    id: number;
    pavu_code: string | null;
    beam_no: string | null;
    ends: number | null;
    production_mode: string | null;
    sizing_job_id: number | null;
  } | null;
  loom: { id: number; loom_code: string | null; shed_no: number | null } | null;
}

interface LoomOpt {
  id: number;
  loom_code: string;
  shed_no: number | null;
}

const MODE_LABEL: Record<string, string> = {
  in_house: 'In-house',
  outsource: 'Outsource',
  jobwork: 'Jobwork',
};

const ASSIGN_STATUS_STYLE: Record<string, string> = {
  queued: 'bg-amber-50 text-amber-700',
  mounted: 'bg-indigo-50 text-indigo-700',
  running: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-slate-100 text-slate-600',
  removed: 'bg-rose-50 text-rose-700',
};

/* ─────────────── small helpers ─────────────── */

function startOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/* ─────────────── data loader ─────────────── */
/* Direct Supabase joins, no stored function — pavu_assign is already the
 * permanent record of every mount event, so this is a straight read plus
 * quality/yarn-count resolution, following the same pattern as the
 * Fabric Movements report.
 *
 * eslint-disable-next-line @typescript-eslint/no-explicit-any
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadMountHistory(supabase: any, from: string, to: string): Promise<MountHistoryRow[]> {
  const { data: assignData } = await supabase
    .from('pavu_assign')
    .select(`
      id, pavu_id, loom_id, costing_id, start_date, end_date,
      metres_produced, actual_metres, status, notes,
      pavu:pavu_id ( id, pavu_code, beam_no, ends, production_mode, sizing_job_id ),
      loom:loom_id ( id, loom_code, shed_no )
    `)
    .gte('start_date', from)
    .lte('start_date', to)
    .order('start_date', { ascending: false });

  const rows = (assignData ?? []) as RawAssignRow[];
  if (rows.length === 0) return [];

  // Quality — mirrors the live fn_pavu_stock_report Postgres function's
  // quality-resolution cascade:
  //   Tier 1: pavu_assign.costing_id -> costing_master, EXCLUDING the
  //     'JOBWORK-EXEMPT' placeholder row (that quality_code is a stand-in
  //     used on jobwork mounts where the specific fabric quality isn't
  //     costing-tracked, so it must never be treated as a real quality).
  //   Tier 2: for jobwork mounts where Tier 1 doesn't apply, fall back to
  //     jobwork_warp_beam.fabric_quality_id (matched to the pavu the same
  //     way warp_count_id already is, below).
  // Both tiers are merge-aware: when the resolved fabric_quality row has
  // is_merged && merged_name, merged_name replaces the display identity for
  // BOTH quality_code and quality_name. (fn_pavu_stock_report also has a
  // Tier 3 warp_ends/warp_count_id costing_master fallback, which is out of
  // scope here — if both tiers above fail to resolve, this falls back to
  // whatever costing_master itself provides, including the literal
  // 'JOBWORK-EXEMPT' code/name.)
  const costingIds = Array.from(
    new Set(rows.map((r) => r.costing_id).filter((v): v is number => v != null)),
  );
  let costingById = new Map<number, { quality_code: string | null; quality_name: string | null }>();
  let fqByCostingId = new Map<number, { name: string | null; is_merged: boolean; merged_name: string | null }>();
  if (costingIds.length > 0) {
    const [cmRes, fqRes] = await Promise.all([
      supabase.from('costing_master').select('id, quality_code, quality_name').in('id', costingIds),
      supabase.from('fabric_quality').select('costing_id, name, is_merged, merged_name').in('costing_id', costingIds),
    ]);
    costingById = new Map(
      ((cmRes.data ?? []) as Array<{ id: number; quality_code: string | null; quality_name: string | null }>).map(
        (c) => [c.id, { quality_code: c.quality_code, quality_name: c.quality_name }],
      ),
    );
    fqByCostingId = new Map(
      (
        (fqRes.data ?? []) as Array<{
          costing_id: number; name: string | null; is_merged: boolean; merged_name: string | null;
        }>
      ).map((f) => [f.costing_id, { name: f.name, is_merged: f.is_merged, merged_name: f.merged_name }]),
    );
  }

  // Yarn count — in-house via pavu.sizing_job_id -> sizing_job.warp_count_id;
  // jobwork via jobwork_warp_beam (pavu_id or the pavu_ids batch array), the
  // same map-building pattern used to fix the Assign-to-Loom modal earlier
  // this session (see app/app/pavu/assign/page.tsx).
  const sizingJobIds = Array.from(
    new Set(rows.map((r) => r.pavu?.sizing_job_id).filter((v): v is number => v != null)),
  );
  let warpCountIdBySizingJob = new Map<number, number>();
  if (sizingJobIds.length > 0) {
    const { data } = await supabase.from('sizing_job').select('id, warp_count_id').in('id', sizingJobIds);
    warpCountIdBySizingJob = new Map(
      ((data ?? []) as Array<{ id: number; warp_count_id: number | null }>)
        .filter((s) => s.warp_count_id != null)
        .map((s) => [s.id, s.warp_count_id as number]),
    );
  }

  const { data: jwbData } = await supabase
    .from('jobwork_warp_beam')
    .select('id, pavu_id, pavu_ids, warp_count_id, fabric_quality_id')
    .order('id', { ascending: true });
  const warpCountIdByPavu = new Map<number, number>();
  // Ascending id order + plain Map.set (last write wins) replicates
  // fn_pavu_stock_report's "ORDER BY jwb.id DESC LIMIT 1" — the
  // highest-id (most recent) jobwork_warp_beam row for a given pavu wins.
  const fqIdByPavu = new Map<number, number>();
  for (const row of (jwbData ?? []) as Array<{
    id: number; pavu_id: number | null; pavu_ids: number[] | null;
    warp_count_id: number | null; fabric_quality_id: number | null;
  }>) {
    const ids = [row.pavu_id, ...(row.pavu_ids ?? [])].filter((id): id is number => id != null);
    if (row.warp_count_id != null) {
      for (const id of ids) warpCountIdByPavu.set(id, row.warp_count_id);
    }
    if (row.fabric_quality_id != null) {
      for (const id of ids) fqIdByPavu.set(id, row.fabric_quality_id);
    }
  }

  const jwbFqIds = Array.from(new Set(fqIdByPavu.values()));
  let fqById = new Map<number, { code: string | null; name: string | null; is_merged: boolean; merged_name: string | null }>();
  if (jwbFqIds.length > 0) {
    const { data } = await supabase
      .from('fabric_quality')
      .select('id, code, name, is_merged, merged_name')
      .in('id', jwbFqIds);
    fqById = new Map(
      (
        (data ?? []) as Array<{
          id: number; code: string | null; name: string | null; is_merged: boolean; merged_name: string | null;
        }>
      ).map((f) => [f.id, { code: f.code, name: f.name, is_merged: f.is_merged, merged_name: f.merged_name }]),
    );
  }

  const warpCountIds = new Set<number>();
  for (const wc of warpCountIdBySizingJob.values()) warpCountIds.add(wc);
  for (const wc of warpCountIdByPavu.values()) warpCountIds.add(wc);
  let yarnCodeById = new Map<number, string>();
  if (warpCountIds.size > 0) {
    const { data } = await supabase.from('yarn_count').select('id, code').in('id', Array.from(warpCountIds));
    yarnCodeById = new Map(
      ((data ?? []) as Array<{ id: number; code: string | null }>)
        .filter((y) => y.code != null)
        .map((y) => [y.id, y.code as string]),
    );
  }

  const today = todayISO();

  return rows.map((r): MountHistoryRow => {
    const cm = r.costing_id != null ? costingById.get(r.costing_id) : undefined;
    const fq = r.costing_id != null ? fqByCostingId.get(r.costing_id) : undefined;
    const tier1Applies = !!cm && cm.quality_code !== 'JOBWORK-EXEMPT';
    const isMerged = tier1Applies && !!(fq?.is_merged && fq.merged_name);

    let qualityCode: string | null;
    let qualityName: string | null;
    if (tier1Applies) {
      // Tier 1 — costing_master via costing_id (real quality, not the
      // JOBWORK-EXEMPT placeholder), merge-aware via fabric_quality.
      qualityCode = isMerged ? fq!.merged_name : cm!.quality_code ?? null;
      qualityName = isMerged
        ? fq!.merged_name
        : fq
          ? fq.name ?? cm!.quality_name ?? null
          : cm!.quality_name ?? null;
    } else {
      // Tier 2 — jobwork_warp_beam.fabric_quality_id fallback (jobwork
      // mounts where the specific quality isn't costing-tracked).
      const jwbFqId = fqIdByPavu.get(r.pavu_id);
      const jwbFq = jwbFqId != null ? fqById.get(jwbFqId) : undefined;
      const jwbIsMerged = !!(jwbFq?.is_merged && jwbFq.merged_name);
      if (jwbFq) {
        qualityCode = jwbIsMerged ? jwbFq.merged_name : jwbFq.code ?? null;
        qualityName = jwbIsMerged ? jwbFq.merged_name : jwbFq.name ?? jwbFq.code ?? null;
      } else {
        // Neither tier resolved — fall back to whatever costing_master
        // itself provides (may genuinely be the JOBWORK-EXEMPT literal).
        qualityCode = cm?.quality_code ?? null;
        qualityName = cm?.quality_name ?? null;
      }
    }

    const sizingJobId = r.pavu?.sizing_job_id;
    const sizingWc = sizingJobId != null ? warpCountIdBySizingJob.get(sizingJobId) : undefined;
    const jwbWc = warpCountIdByPavu.get(r.pavu_id);
    const warpCountId = sizingWc ?? jwbWc;
    const yarnCount = warpCountId != null ? yarnCodeById.get(warpCountId) ?? null : null;

    const mountDate = r.start_date;
    const unmountDate = r.end_date;
    const daysMounted =
      mountDate != null
        ? Math.max(
            0,
            Math.round(
              (new Date(unmountDate ?? today).getTime() - new Date(mountDate).getTime()) / 86_400_000,
            ),
          )
        : null;

    return {
      assign_id: r.id,
      pavu_id: r.pavu_id,
      pavu_code: r.pavu?.pavu_code ?? '—',
      beam_no: r.pavu?.beam_no ?? '—',
      ends: r.pavu?.ends ?? 0,
      yarn_count: yarnCount,
      quality_code: qualityCode,
      quality_name: qualityName,
      production_mode: r.pavu?.production_mode ?? null,
      loom_id: r.loom_id,
      loom_code: r.loom?.loom_code ?? null,
      shed_no: r.loom?.shed_no ?? null,
      mount_date: mountDate,
      unmount_date: unmountDate,
      days_mounted: daysMounted,
      metres_produced: Number(r.metres_produced ?? 0),
      actual_metres: Number(r.actual_metres ?? 0),
      status: r.status,
      notes: r.notes,
    };
  });
}

/* ─────────────── page ─────────────── */

interface PageProps {
  searchParams: Promise<{
    from?: string;
    to?: string;
    loom_id?: string;
    shed?: string;
    mode?: string;
    quality_code?: string;
    ends?: string;
  }>;
}

export default async function PavuMountHistoryReport({ searchParams }: PageProps) {
  const sp = await searchParams;
  const from = sp.from ?? startOfMonthISO();
  const to = sp.to ?? todayISO();
  const loomIdParam = sp.loom_id ?? '';
  const loomIdNum = loomIdParam && /^\d+$/.test(loomIdParam) ? Number(loomIdParam) : null;
  const shedParam = sp.shed ?? '';
  const modeFilter = sp.mode ?? '';
  const qualityCodeFilter = sp.quality_code ?? '';
  const endsParam = sp.ends ?? '';
  const endsNum = endsParam && /^\d+$/.test(endsParam) ? Number(endsParam) : null;

  const supabase = await createClient();

  const [allRows, loomRes] = await Promise.all([
    loadMountHistory(supabase, from, to).catch((): MountHistoryRow[] => []),
    supabase.from('loom').select('id, loom_code, shed_no').order('loom_code', { ascending: true }),
  ]);

  const looms = (loomRes.data as unknown as LoomOpt[]) ?? [];
  const loadError = loomRes.error?.message ?? null;

  // Filter option lists — derived from the date-filtered rows, mirroring
  // Beam Stock Report (options computed from the loaded set, not the
  // post-filter set, so picking one facet doesn't hide the others).
  const endsOptions = Array.from(new Set(allRows.map((r) => r.ends))).sort((a, b) => a - b);
  const shedOptions = Array.from(
    new Set(allRows.map((r) => r.shed_no).filter((v): v is number => v != null)),
  ).sort((a, b) => a - b);
  const modeOptions = Array.from(
    new Set(allRows.map((r) => r.production_mode).filter((v): v is string => !!v)),
  ).sort();
  const qualityOptions = Array.from(
    new Map(
      allRows
        .filter((r) => r.quality_code != null)
        .map((r) => [r.quality_code as string, r.quality_name ?? r.quality_code!]),
    ).entries(),
  ).sort((a, b) => a[0].localeCompare(b[0]));

  const rows = allRows.filter((r) => {
    if (loomIdNum != null && r.loom_id !== loomIdNum) return false;
    if (shedParam && String(r.shed_no ?? '') !== shedParam) return false;
    if (modeFilter && r.production_mode !== modeFilter) return false;
    if (qualityCodeFilter && r.quality_code !== qualityCodeFilter) return false;
    if (endsNum != null && r.ends !== endsNum) return false;
    return true;
  });

  // Summary rolled up by quality — mirrors Beam Stock Report's "Summary by
  // ends & yarn count" table.
  const summaryMap = new Map<string, { quality_code: string; quality_name: string | null; count: number; metres: number }>();
  for (const r of rows) {
    const key = r.quality_code ?? '—';
    const cur = summaryMap.get(key) ?? { quality_code: key, quality_name: r.quality_name, count: 0, metres: 0 };
    cur.count += 1;
    cur.metres += r.metres_produced;
    summaryMap.set(key, cur);
  }
  const summary = Array.from(summaryMap.values()).sort((a, b) => a.quality_code.localeCompare(b.quality_code));

  const totalMetres = rows.reduce((s, r) => s + r.metres_produced, 0);
  const stillMounted = rows.filter((r) => r.status === 'mounted' || r.status === 'running').length;

  const exportColumns: ExcelColumn[] = [
    { key: 'pavu_code', label: 'Pavu Code', type: 'text', width: 14 },
    { key: 'beam_no', label: 'Beam No', type: 'text', width: 12 },
    { key: 'ends', label: 'Ends', type: 'number', width: 8 },
    { key: 'yarn_count', label: 'Yarn Count', type: 'text', width: 12 },
    { key: 'quality_code', label: 'Quality Code', type: 'text', width: 14 },
    { key: 'quality_name', label: 'Quality Name', type: 'text', width: 24 },
    { key: 'mode_label', label: 'Mode', type: 'text', width: 12 },
    { key: 'loom_code', label: 'Loom', type: 'text', width: 10 },
    { key: 'shed_no', label: 'Shed', type: 'number', width: 8 },
    { key: 'mount_date', label: 'Mount Date', type: 'date', width: 13 },
    { key: 'unmount_date', label: 'Unmount Date', type: 'date', width: 13 },
    { key: 'days_mounted', label: 'Days Mounted', type: 'number', width: 12 },
    { key: 'metres_produced', label: 'Metres Produced', type: 'metre', width: 14, total: true },
    { key: 'actual_metres', label: 'Actual Metres', type: 'metre', width: 14, total: true },
    { key: 'status', label: 'Status', type: 'text', width: 12 },
  ];
  const exportRows = rows.map((r) => ({
    pavu_code: r.pavu_code,
    beam_no: r.beam_no,
    ends: r.ends,
    yarn_count: r.yarn_count ?? '',
    quality_code: r.quality_code ?? '',
    quality_name: r.quality_name ?? '',
    mode_label: r.production_mode ? MODE_LABEL[r.production_mode] ?? r.production_mode : '',
    loom_code: r.loom_code ?? '',
    shed_no: r.shed_no ?? '',
    mount_date: r.mount_date ?? '',
    unmount_date: r.unmount_date ?? '',
    days_mounted: r.days_mounted ?? '',
    metres_produced: r.metres_produced,
    actual_metres: r.actual_metres,
    status: r.status,
  }));

  return (
    <div>
      <PageHeader
        title="Pavu Mount History"
        crumbs={[{ label: 'Reports', href: '/app/reports' }, { label: 'Pavu Mount History' }]}
        subtitle={`Every beam mounted between ${from} and ${to} — which loom it went on, what came off it, and how many metres it produced.`}
        actions={
          <ExcelExportButton
            filename="pavu-mount-history"
            sheetName="Mount History"
            title={`Pavu Mount History · ${from} to ${to}`}
            columns={exportColumns}
            rows={exportRows}
          />
        }
      />

      {/* ─────────────── Filter strip ─────────────── */}
      <form className="card p-3 mb-4 flex flex-wrap gap-3 items-end text-sm" action="">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">From</span>
          <input type="date" name="from" defaultValue={from} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">To</span>
          <input type="date" name="to" defaultValue={to} className="input" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Loom</span>
          <select name="loom_id" defaultValue={loomIdParam} className="input min-w-[140px]">
            <option value="">All looms</option>
            {looms.map((l) => (
              <option key={l.id} value={l.id}>{l.loom_code}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Shed</span>
          <select name="shed" defaultValue={shedParam} className="input min-w-[110px]">
            <option value="">All sheds</option>
            {shedOptions.map((s) => (
              <option key={s} value={s}>Shed {s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Mode</span>
          <select name="mode" defaultValue={modeFilter} className="input min-w-[130px]">
            <option value="">All modes</option>
            {modeOptions.map((m) => (
              <option key={m} value={m}>{MODE_LABEL[m] ?? m}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Quality</span>
          <select name="quality_code" defaultValue={qualityCodeFilter} className="input min-w-[180px]">
            <option value="">All qualities</option>
            {qualityOptions.map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-mute">Ends</span>
          <select name="ends" defaultValue={endsParam} className="input min-w-[100px]">
            <option value="">All</option>
            {endsOptions.map((e) => (
              <option key={e} value={e}>{e}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-primary">Apply</button>
        <a href="/app/reports/pavu-mount-history" className="text-xs text-ink-mute self-center hover:text-ink underline">
          Reset
        </a>
      </form>

      {loadError && (
        <div className="card p-4 text-sm text-err mb-4">Could not load loom list: {loadError}</div>
      )}

      {/* ─────────────── KPI strip ─────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        <Kpi label="Mount events" value={String(rows.length)} icon={History} />
        <Kpi label="Still mounted" value={String(stillMounted)} icon={Gauge} />
        <Kpi label="Metres produced" value={formatMetres(totalMetres, 0)} icon={Layers} />
      </div>

      {/* ─────────────── Summary by quality ─────────────── */}
      {summary.length > 0 && (
        <div className="card p-4 mb-4 overflow-x-auto">
          <div className="text-xs uppercase tracking-wide text-ink-mute mb-2">Summary by quality</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-mute border-b border-line/60">
                <th className="py-1.5 pr-3">Quality</th>
                <th className="py-1.5 pr-3 text-right">Mounts</th>
                <th className="py-1.5 pr-3 text-right">Metres produced</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.quality_code} className="border-b border-line/30 last:border-0">
                  <td className="py-1.5 pr-3">
                    {s.quality_code}
                    {s.quality_name && <span className="text-ink-mute"> — {s.quality_name}</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right num">{s.count}</td>
                  <td className="py-1.5 pr-3 text-right num">{formatMetres(s.metres, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ─────────────── Detail ─────────────── */}
      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-mute">
          No mount events in this window. Try widening the date range or clearing a filter.
        </div>
      ) : (
        <>
          <CardFilter placeholder="Search mount history…">
            {rows.map((r) => (
              <div key={r.assign_id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink break-words">
                      {r.pavu_code} <span className="text-ink-mute">/ {r.beam_no}</span>
                    </div>
                    <div className="text-[10px] text-ink-mute">
                      {r.ends} ends · {r.yarn_count ?? '—'}
                      {r.quality_code ? ` · ${r.quality_code}` : ''}
                    </div>
                  </div>
                  <span className={`pill ${ASSIGN_STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'} text-[11px] uppercase tracking-wide shrink-0`}>
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-ink-soft mt-2 space-y-1">
                  <div>Loom: <span className="text-ink">{r.loom_code ?? '—'}{r.shed_no != null ? ` (Shed ${r.shed_no})` : ''}</span></div>
                  <div>Mode: {r.production_mode ? MODE_LABEL[r.production_mode] ?? r.production_mode : '—'}</div>
                  <div>Mounted: <span className="num">{fmtDate(r.mount_date)}</span> → Unmounted: <span className="num">{fmtDate(r.unmount_date)}</span></div>
                  <div>Days mounted: <span className="num">{r.days_mounted ?? '—'}</span></div>
                  <div>Metres: <span className="num">{formatMetres(r.metres_produced, 1)}</span> produced / <span className="num">{formatMetres(r.actual_metres, 1)}</span> actual</div>
                </div>
              </div>
            ))}
          </CardFilter>

          <div className="card p-0 overflow-x-auto hidden md:block">
            <table className="w-full text-sm min-w-[1100px]">
              <thead className="bg-cloud/60 text-[11px] uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="text-left px-3 py-3">Beam</th>
                  <th className="text-left px-3 py-3">Ends</th>
                  <th className="text-left px-3 py-3">Yarn</th>
                  <th className="text-left px-3 py-3">Quality</th>
                  <th className="text-left px-3 py-3">Mode</th>
                  <th className="text-left px-3 py-3">Loom / Shed</th>
                  <th className="text-left px-3 py-3">Mounted</th>
                  <th className="text-left px-3 py-3">Unmounted</th>
                  <th className="text-right px-3 py-3">Days</th>
                  <th className="text-right px-3 py-3">Metres</th>
                  <th className="text-left px-3 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.assign_id} className="border-t border-line/40 hover:bg-haze/60">
                    <td className="px-3 py-2 font-mono text-xs">{r.pavu_code} <span className="text-ink-mute">/ {r.beam_no}</span></td>
                    <td className="px-3 py-2 num text-xs">{r.ends}</td>
                    <td className="px-3 py-2 text-xs">{r.yarn_count ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">
                      {r.quality_code ?? '—'}
                      {r.quality_name && <div className="text-[10px] text-ink-mute">{r.quality_name}</div>}
                    </td>
                    <td className="px-3 py-2 text-xs">{r.production_mode ? MODE_LABEL[r.production_mode] ?? r.production_mode : '—'}</td>
                    <td className="px-3 py-2 text-xs">{r.loom_code ?? '—'}{r.shed_no != null ? ` (S${r.shed_no})` : ''}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.mount_date)}</td>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{fmtDate(r.unmount_date)}</td>
                    <td className="px-3 py-2 text-right num text-xs">{r.days_mounted ?? '—'}</td>
                    <td className="px-3 py-2 text-right num text-xs">{formatMetres(r.metres_produced, 1)}</td>
                    <td className="px-3 py-2">
                      <span className={`pill ${ASSIGN_STATUS_STYLE[r.status] ?? 'bg-slate-100 text-slate-600'} text-[11px] uppercase tracking-wide`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────── presentational helpers ─────────────── */

interface KpiProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
}

function Kpi({ label, value, icon: Icon }: KpiProps) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-ink-mute">{label}</div>
        <Icon className="w-4 h-4 text-ink-mute" />
      </div>
      <div className="num text-xl font-bold">{value}</div>
    </div>
  );
}
