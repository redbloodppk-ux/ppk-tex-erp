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

  // Quality — resolved through costing_id -> fabric_quality (merge-aware),
  // falling back to costing_master.quality_code/quality_name. When a costing's
  // fabric_quality is merged (is_merged && merged_name), merged_name replaces
  // the display identity for BOTH quality_code and quality_name — mirroring
  // the pattern in fn_production_vs_delivery (see
  // db/migrations/153_production_vs_delivery_label_by_fq_mode.sql), applied
  // directly here since each pavu_assign row already carries the specific
  // costing_id it was mounted under (no "latest assign" lookup needed).
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
    .select('pavu_id, pavu_ids, warp_count_id');
  const warpCountIdByPavu = new Map<number, number>();
  for (const row of (jwbData ?? []) as Array<{
    pavu_id: number | null; pavu_ids: number[] | null; warp_count_id: number | null;
  }>) {
    if (row.warp_count_id == null) continue;
    const ids = [row.pavu_id, ...(row.pavu_ids ?? [])].filter((id): id is number => id != null);
    for (const id of ids) warpCountIdByPavu.set(id, row.warp_count_id);
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
    const isMerged = !!(fq?.is_merged && fq.merged_name);
    const qualityCode = isMerged ? fq!.merged_name : cm?.quality_code ?? null;
    const qualityName = isMerged
      ? fq!.merged_name
      : fq
        ? fq.name ?? cm?.quality_name ?? null
        : cm?.quality_name ?? null;

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

export default async function PavuMountHistoryReport() {
  return <div>Loading…</div>;
}
